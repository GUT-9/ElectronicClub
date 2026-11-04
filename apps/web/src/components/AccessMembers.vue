<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { AccessMember, Page, Role } from '@electronic-club/shared'
import { request } from '../member-api'
import { useAuthStore } from '../stores/auth'
const props = defineProps<{
  scope: 'roles' | 'permissions'
  id: string
  roles: Role[]
}>()
const emit = defineEmits<{ changed: [] }>()
const auth = useAuthStore(),
  router = useRouter()
const rows = ref<AccessMember[]>([]),
  total = ref(0),
  page = ref(1),
  search = ref(''),
  status = ref('all'),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
const dialog = ref<HTMLDialogElement>(),
  studentId = ref(''),
  candidate = ref<AccessMember>(),
  roleId = ref(''),
  removing = ref<AccessMember>(),
  replacement = ref('')
let generation = 0
const grantable = computed(() =>
  props.roles.filter(
    (r) =>
      auth.identity?.super || (!r.super && r.permissionIds.every(auth.can)),
  ),
)
const sources = computed(() =>
  grantable.value.filter((r) =>
    props.scope === 'roles'
      ? r.id === props.id
      : r.super || r.permissionIds.includes(props.id),
  ),
)
const alternatives = computed(() =>
  grantable.value.filter((r) => r.id !== roleId.value),
)
function canManage(m: AccessMember) {
  return (
    auth.can('roles.assign') &&
    (auth.identity?.super ||
      m.roles.every((r) => {
        const role = props.roles.find((x) => x.id === r.id)
        return role && !role.super && role.permissionIds.every(auth.can)
      }))
  )
}
async function load() {
  const seq = ++generation
  if (!auth.can('members.read')) return
  busy.value = true
  error.value = ''
  try {
    const q = new URLSearchParams({
      page: String(page.value),
      pageSize: '20',
      search: search.value,
      status: status.value,
    })
    const result = await request<Page<AccessMember>>(
      `/${props.scope}/${props.id}/members?${q}`,
    )
    if (seq === generation) {
      rows.value = result.items
      total.value = result.total
    }
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message
  } finally {
    if (seq === generation) busy.value = false
  }
}
function reset() {
  page.value = 1
  void load()
}
watch(
  () => [props.scope, props.id],
  () => {
    status.value = props.scope === 'roles' ? 'all' : 'active'
    search.value = ''
    reset()
  },
  { immediate: true },
)
watch(studentId, () => {
  candidate.value = undefined
})
function openAdd() {
  removing.value = undefined
  candidate.value = undefined
  studentId.value = ''
  roleId.value =
    sources.value.find((r) => !r.super)?.id ?? sources.value[0]?.id ?? ''
  error.value = ''
  dialog.value?.showModal()
}
function openRemove(m: AccessMember, id: string) {
  removing.value = m
  candidate.value = m
  roleId.value = id
  replacement.value =
    alternatives.value.find((r) => r.id === 'role_member')?.id ?? ''
  error.value = ''
  dialog.value?.showModal()
}
async function lookup() {
  busy.value = true
  error.value = ''
  try {
    candidate.value = await request<AccessMember>(
      `/roles/member-lookup?studentId=${encodeURIComponent(studentId.value.trim())}`,
    )
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
async function submit() {
  if (!candidate.value || !roleId.value) return
  busy.value = true
  error.value = ''
  try {
    const m = candidate.value
    const result = await request<{ changed: boolean }>(
      `/roles/${roleId.value}/members/${m.uid}`,
      'POST',
      {
        action: removing.value ? 'remove' : 'add',
        ...(removing.value && m.roleIds.length === 1
          ? { replacementRoleId: replacement.value }
          : {}),
      },
    )
    dialog.value?.close()
    notice.value = result.changed
      ? '角色分配已更新。成员的旧登录会话已失效，重新登录后生效。'
      : '该成员已拥有此角色，无需重复添加。'
    if (result.changed && m.uid === auth.member?.uid) {
      auth.clear()
      await router.push('/login')
      return
    }
    emit('changed')
    await load()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
function previous() {
  page.value--
  void load()
}
function next() {
  page.value++
  void load()
}
</script>
<template>
  <section class="access-roster">
    <p v-if="!auth.can('members.read')" class="access-note">
      查看成员名单还需要「查看成员」权限，请联系管理员配置。
    </p>
    <template v-else>
      <div class="access-toolbar">
        <form @submit.prevent="reset">
          <input
            v-model="search"
            aria-label="搜索成员"
            placeholder="搜索姓名、昵称或学号"
            maxlength="80"
          /><select v-model="status" aria-label="成员状态" @change="reset">
            <option value="all">全部状态</option>
            <option value="active">正常成员</option>
            <option value="disabled">已禁用</option>
            <option value="deleted">已删除</option></select
          ><button class="plain-button" :disabled="busy">搜索</button>
        </form>
        <button
          v-if="auth.can('roles.assign')"
          class="button button-primary"
          :disabled="!sources.length || busy"
          @click="openAdd"
        >
          添加成员
        </button>
      </div>
      <p class="access-note">
        共
        {{ total }}
        人。已禁用或已删除的账号无法使用权限。移除来源角色也会同时移除该角色授予的其他权限。
      </p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <p v-if="error" role="alert" class="danger">{{ error }}</p>
      <div class="access-table">
        <table>
          <thead>
            <tr>
              <th>成员</th>
              <th>学号</th>
              <th>状态</th>
              <th>
                {{
                  scope === 'permissions' ? '授予该权限的角色' : '拥有的角色'
                }}
              </th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in rows" :key="m.uid">
              <td>
                <strong>{{ m.name }}</strong
                ><small>{{ m.nickname }}</small>
              </td>
              <td>{{ m.studentId }}</td>
              <td>
                {{
                  { active: '正常', disabled: '已禁用', deleted: '已删除' }[
                    m.status
                  ]
                }}
              </td>
              <td>
                <span
                  v-for="r in scope === 'permissions' ? m.sources : m.roles"
                  :key="r.id"
                  class="access-tag"
                  >{{ r.name }}</span
                >
              </td>
              <td>
                <template v-if="canManage(m) && m.status !== 'deleted'"
                  ><button
                    v-for="r in m.sources.filter((s) =>
                      grantable.some((g) => g.id === s.id),
                    )"
                    :key="r.id"
                    class="plain-button danger"
                    :disabled="busy"
                    @click="openRemove(m, r.id)"
                  >
                    移除{{ scope === 'permissions' ? ' ' + r.name : '' }}
                  </button></template
                ><span v-else class="access-note">仅查看</span>
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="5">
                {{ busy ? '正在加载…' : '没有符合条件的成员' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="access-pagination">
        <span>第 {{ page }} 页 · 每页 20 人</span
        ><button
          class="plain-button"
          :disabled="busy || page === 1"
          @click="previous"
        >
          上一页</button
        ><button
          class="plain-button"
          :disabled="busy || page * 20 >= total"
          @click="next"
        >
          下一页
        </button>
      </div>
    </template>
    <dialog ref="dialog" class="access-dialog">
      <form @submit.prevent="submit">
        <h2>{{ removing ? '移除角色' : '添加角色成员' }}</h2>
        <p v-if="error" role="alert" class="danger">{{ error }}</p>
        <template v-if="!removing"
          ><label
            >授予角色<select v-model="roleId" required :disabled="busy">
              <option v-for="r in sources" :key="r.id" :value="r.id">
                {{ r.name }}{{ r.super ? '（全部系统权限）' : '' }}
              </option>
            </select></label
          ><label
            >成员学号<input
              v-model="studentId"
              maxlength="24"
              :disabled="busy"
              placeholder="输入完整学号，保留前导零" /></label
          ><button
            type="button"
            class="plain-button"
            :disabled="busy || !studentId.trim()"
            @click="lookup"
          >
            查找成员
          </button></template
        >
        <div v-if="candidate" class="access-note">
          <strong>{{ candidate.name }} · {{ candidate.studentId }}</strong>
          <p>当前角色：{{ candidate.roles.map((r) => r.name).join('、') }}</p>
          <p v-if="removing">
            将移除「{{
              roles.find((r) => r.id === roleId)?.name
            }}」。其他角色保留。{{
              scope === 'permissions' && candidate.sources.length > 1
                ? '该成员仍可从其他来源角色获得此权限。'
                : ''
            }}
          </p>
          <label v-if="removing && candidate.roleIds.length === 1"
            >请选择替代角色（成员至少保留一个角色）<select
              v-model="replacement"
              required
            >
              <option value="" disabled>选择替代角色</option>
              <option v-for="r in alternatives" :key="r.id" :value="r.id">
                {{ r.name }}
              </option>
            </select></label
          >
          <p
            v-if="!removing && roles.find((r) => r.id === roleId)?.super"
            class="danger"
          >
            此角色授予全部系统权限，请确认该成员应成为超级管理员。
          </p>
        </div>
        <div class="action-row">
          <button
            class="button button-primary"
            :disabled="busy || !candidate || !roleId"
          >
            {{
              busy ? '处理中…' : '确认' + (removing ? '移除' : '添加')
            }}</button
          ><button
            type="button"
            class="plain-button"
            :disabled="busy"
            @click="dialog?.close()"
          >
            取消
          </button>
        </div>
      </form>
    </dialog>
  </section>
</template>
