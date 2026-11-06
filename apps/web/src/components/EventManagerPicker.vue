<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { MAX_EVENT_MANAGERS } from '@electronic-club/shared'
import type { EventManagerOption, Page } from '@electronic-club/shared'
import { request } from '../member-api'
import { useAuthStore } from '../stores/auth'
const props = defineProps<{
  modelValue: string[]
  readonly: boolean
  eventId?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [string[]]; busy: [boolean] }>()
const auth = useAuthStore(),
  search = ref(''),
  roleId = ref(''),
  roles = ref<{ id: string; name: string }[]>([]),
  page = ref(1),
  total = ref(0),
  candidates = ref<EventManagerOption[]>([]),
  labels = ref<Record<string, EventManagerOption>>({}),
  loading = ref(false),
  error = ref(''),
  notice = ref('')
let generation = 0,
  labelGeneration = 0
const selected = computed(() =>
  props.modelValue.map(
    (uid) =>
      labels.value[uid] ??
      (uid === auth.member?.uid
        ? {
            uid,
            name: auth.member.name,
            nickname: auth.member.nickname,
            status: 'active',
            roles: auth.identity?.roles ?? [],
          }
        : {
            uid,
            name: '成员资料待加载',
            nickname: '',
            status: 'active',
            roles: [],
          }),
  ),
)
function remember(items: EventManagerOption[]) {
  labels.value = {
    ...labels.value,
    ...Object.fromEntries(items.map((m) => [m.uid, m])),
  }
}
async function loadLabels() {
  const seq = ++labelGeneration
  if (!props.modelValue.length) return
  if (props.readonly && !props.eventId) return
  try {
    const result = props.readonly
      ? await request<{ items: EventManagerOption[] }>(
          `/events/${props.eventId}/managers`,
        )
      : await request<{ items: EventManagerOption[] }>(
          '/events/manager-options/resolve',
          'POST',
          { uids: props.modelValue },
        )
    if (seq === labelGeneration) remember(result.items)
  } catch (e) {
    if (seq === labelGeneration) error.value = (e as Error).message
  }
}
async function load() {
  if (props.readonly) return
  const seq = ++generation
  loading.value = true
  error.value = ''
  emit('busy', true)
  try {
    const result = await request<Page<EventManagerOption>>(
      '/events/manager-options?' +
        new URLSearchParams({
          search: search.value,
          roleId: roleId.value,
          page: String(page.value),
          pageSize: '20',
        }),
    )
    if (seq === generation) {
      candidates.value = result.items
      total.value = result.total
      remember(result.items)
    }
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message
  } finally {
    if (seq === generation) {
      loading.value = false
      emit('busy', false)
    }
  }
}
function add(items: EventManagerOption[]) {
  const ids = [...new Set([...props.modelValue, ...items.map((m) => m.uid)])]
  if (ids.length > MAX_EVENT_MANAGERS) {
    error.value = `负责人最多${MAX_EVENT_MANAGERS}人，请减少选择`
    return
  }
  remember(items)
  emit('update:modelValue', ids)
  notice.value = `已选择${ids.length}位负责人，保存活动后生效。`
}
function toggle(member: EventManagerOption) {
  if (props.modelValue.includes(member.uid)) remove(member.uid)
  else add([member])
}
function remove(uid: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter((id) => id !== uid),
  )
  notice.value = '负责人选择已修改，保存活动后生效。'
}
async function addRole() {
  if (!roleId.value || loading.value) return
  const eventId = props.eventId
  loading.value = true
  emit('busy', true)
  error.value = ''
  try {
    const result = await request<{ items: EventManagerOption[] }>(
      '/events/manager-options/by-role',
      'POST',
      { roleIds: [roleId.value] },
    )
    if (eventId !== props.eventId) return
    add(result.items)
    if (!result.items.length) notice.value = '该角色暂无有效成员。'
  } catch (e) {
    if (eventId === props.eventId) error.value = (e as Error).message
  } finally {
    loading.value = false
    emit('busy', false)
  }
}
function searchMembers() {
  if (loading.value) return
  page.value = 1
  void load()
}
function changePage(delta: number) {
  page.value += delta
  void load()
}
watch(() => [props.eventId, props.modelValue.join(',')], loadLabels, {
  immediate: true,
})
onMounted(async () => {
  if (props.readonly) return
  try {
    const items: { id: string; name: string }[] = []
    for (let p = 1; p <= 100; p++) {
      const result = await request<Page<{ id: string; name: string }>>(
        `/events/manager-roles?page=${p}`,
      )
      items.push(...result.items)
      if (items.length >= result.total) break
    }
    roles.value = items
    await load()
  } catch (e) {
    error.value = (e as Error).message
  }
})
</script>
<template>
  <section class="event-manager-picker" aria-labelledby="event-managers-title">
    <header>
      <h3 id="event-managers-title">活动负责人</h3>
      <span>已选 {{ modelValue.length }} / {{ MAX_EVENT_MANAGERS }} 人</span>
    </header>
    <p>
      负责人可管理此活动、审核报名及签到。保存活动后生效；按角色添加的是当前成员名单，后续角色变动不会自动更改负责人。
    </p>
    <ul v-if="selected.length" class="event-manager-chips">
      <li v-for="member in selected" :key="member.uid">
        <span
          ><strong>{{ member.name }}</strong
          ><small>{{
            member.roles.map((r) => r.name).join(' · ') || member.nickname
          }}</small
          ><small v-if="member.status !== 'active'"
            >账号已停用，仅保留历史授权</small
          ></span
        ><button
          v-if="!readonly"
          type="button"
          :disabled="loading"
          :aria-label="'移除负责人 ' + member.name"
          @click="remove(member.uid)"
        >
          ×
        </button>
      </li>
    </ul>
    <p v-else>尚未选择负责人。创建者会自动加入。</p>
    <template v-if="!readonly">
      <div class="event-manager-search">
        <label
          >搜索成员<input
            v-model="search"
            :disabled="loading"
            maxlength="100"
            placeholder="姓名、昵称或学号"
            @keydown.enter.prevent="searchMembers"
        /></label>
        <label
          >按角色筛选<select
            v-model="roleId"
            :disabled="loading"
            @change="searchMembers"
          >
            <option value="">全部角色</option>
            <option v-for="role in roles" :key="role.id" :value="role.id">
              {{ role.name }}
            </option>
          </select></label
        >
        <button
          type="button"
          class="plain-button"
          :disabled="loading"
          @click="searchMembers"
        >
          搜索成员
        </button>
        <button
          type="button"
          class="plain-button"
          :disabled="loading || !roleId"
          @click="addRole"
        >
          添加该角色全部成员
        </button>
      </div>
      <div class="event-manager-candidates" :aria-busy="loading">
        <label v-for="member in candidates" :key="member.uid"
          ><input
            type="checkbox"
            :checked="modelValue.includes(member.uid)"
            :disabled="loading"
            @change="toggle(member)"
          /><span
            ><strong>{{ member.name }}</strong
            ><small
              >{{ member.roles.map((r) => r.name).join(' · ')
              }}<template v-if="member.nickname !== member.name">
                · {{ member.nickname }}</template
              ></small
            ></span
          ></label
        >
        <p v-if="!loading && !candidates.length">没有符合条件的有效成员。</p>
      </div>
      <div class="publication-tools">
        <button
          type="button"
          :disabled="loading || !candidates.length"
          @click="add(candidates)"
        >
          添加当前页</button
        ><button
          type="button"
          :disabled="loading || page === 1"
          @click="changePage(-1)"
        >
          上一页</button
        ><span>第 {{ page }} 页 · 共 {{ total }} 人</span
        ><button
          type="button"
          :disabled="loading || page * 20 >= total"
          @click="changePage(1)"
        >
          下一页
        </button>
      </div>
    </template>
    <p v-else>只有获得全局活动编辑权限的管理员可以调整负责人。</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.event-manager-picker {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  padding: 20px;
  margin: 18px 0;
}
.event-manager-picker header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.event-manager-picker h3 {
  margin: 0;
  font-size: 18px;
}
.event-manager-picker p {
  font-size: 13px;
  line-height: 1.8;
}
.event-manager-picker header > span {
  font-size: 13px;
  color: var(--blue);
}
.event-manager-chips {
  list-style: none;
  padding: 0;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.event-manager-chips li {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #f0f5ff;
  border: 1px solid #dce7f6;
  padding: 9px 12px;
  border-radius: 6px;
  max-width: 100%;
}
.event-manager-chips small,
.event-manager-candidates small {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-top: 3px;
  overflow-wrap: anywhere;
}
.event-manager-chips button {
  border: 0;
  background: transparent;
  color: var(--blue);
  font-size: 22px;
}
.event-manager-search {
  display: flex;
  align-items: end;
  gap: 10px;
  flex-wrap: wrap;
}
.event-manager-search label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  flex: 1 1 160px;
}
.event-manager-search input,
.event-manager-search select {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  min-width: 0;
  width: 100%;
}
.event-manager-candidates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 16px 0;
}
.event-manager-candidates label {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
}
.event-manager-candidates input[type='checkbox'] {
  width: 16px;
  height: 16px;
  margin: 0;
}
.event-manager-candidates strong {
  font-size: 14px;
}
.event-manager-candidates span {
  min-width: 0;
}
.event-manager-picker [role='alert'] {
  color: #c42b35;
}
@media (max-width: 600px) {
  .event-manager-picker {
    padding: 14px;
  }
  .event-manager-candidates {
    grid-template-columns: 1fr;
  }
  .event-manager-search button {
    flex: 1 1 100%;
  }
}
</style>
