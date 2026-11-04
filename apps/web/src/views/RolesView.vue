<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { Role, Permission } from '@electronic-club/shared'
import {
  permissionGroup,
  PERMISSION_GROUP_ORDER,
} from '@electronic-club/shared'
import { request, allRoles } from '../member-api'
import { useAuthStore } from '../stores/auth'
import AccessMembers from '../components/AccessMembers.vue'
const auth = useAuthStore(),
  route = useRoute(),
  roles = ref<Role[]>([]),
  permissions = ref<Permission[]>([]),
  selected = ref(''),
  permissionId = ref(''),
  search = ref(''),
  message = ref(''),
  busy = ref(false),
  tab = ref('permissions'),
  showIds = ref(false),
  showReserved = ref(false)
const form = reactive({
  name: '',
  description: '',
  permissionIds: [] as string[],
})
const permissionMode = computed(() => route.path.endsWith('permissions'))
const current = computed(() => roles.value.find((r) => r.id === selected.value))
const capability = computed(() =>
  permissions.value.find((p) => p.id === permissionId.value),
)
const visiblePermissions = computed(() =>
  permissions.value.filter(
    (p) =>
      (p.implemented || showReserved.value) &&
      (!permissionMode.value ||
        `${p.name} ${p.group} ${p.id}`
          .toLowerCase()
          .includes(search.value.toLowerCase())),
  ),
)
const groups = computed(() => [
  ...PERMISSION_GROUP_ORDER.filter((g) =>
    visiblePermissions.value.some((p) => p.group === g),
  ),
])
const visibleRoles = computed(() =>
  roles.value.filter((r) =>
    `${r.name} ${r.description}`.includes(search.value),
  ),
)
const granting = computed(() =>
  roles.value.filter(
    (r) => r.super || r.permissionIds.includes(permissionId.value),
  ),
)
const editable = computed(
  () =>
    auth.can('roles.manage') &&
    !current.value?.super &&
    (auth.identity?.super ||
      !current.value ||
      current.value.permissionIds.every(auth.can)),
)
function populate() {
  Object.assign(
    form,
    current.value
      ? {
          name: current.value.name,
          description: current.value.description,
          permissionIds: [...current.value.permissionIds],
        }
      : { name: '', description: '', permissionIds: [] },
  )
}
const dirty = computed(
  () =>
    form.name !== (current.value?.name ?? '') ||
    form.description !== (current.value?.description ?? '') ||
    JSON.stringify([...form.permissionIds].sort()) !==
      JSON.stringify([...(current.value?.permissionIds ?? [])].sort()),
)
function choose(id: string) {
  if (dirty.value && !window.confirm('尚有未保存的角色修改，放弃这些修改？'))
    return
  selected.value = id
  populate()
  message.value = ''
  tab.value = 'permissions'
}
function newRole() {
  choose('')
}
async function load() {
  roles.value = await allRoles()
  permissions.value = (await request<Permission[]>('/permissions')).map(
    (p) => ({ ...p, group: permissionGroup(p.id) }),
  )
}
async function action(fn: () => Promise<void>) {
  busy.value = true
  message.value = ''
  try {
    await fn()
  } catch (e) {
    message.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
async function save() {
  await action(async () => {
    const role = await request<Role>(
      selected.value ? `/roles/${selected.value}` : '/roles',
      selected.value ? 'PUT' : 'POST',
      form,
    )
    selected.value = role.id
    await load()
    populate()
    message.value = '角色及权限已保存，下次请求即读取最新权限。'
    await auth.restore(true)
  })
}
async function remove() {
  if (
    !current.value ||
    !window.confirm(`删除未使用的角色「${current.value.name}」？`)
  )
    return
  await action(async () => {
    await request(`/roles/${selected.value}`, 'DELETE', {})
    selected.value = ''
    await load()
    populate()
    message.value = '角色已删除'
  })
}
function toggleGroup(group: string) {
  const ids = visiblePermissions.value
    .filter((p) => p.group === group && auth.can(p.id))
    .map((p) => p.id)
  const all = ids.every((id) => form.permissionIds.includes(id))
  form.permissionIds = all
    ? form.permissionIds.filter((id) => !ids.includes(id))
    : [...new Set([...form.permissionIds, ...ids])]
}
watch(
  () => route.fullPath,
  () => {
    search.value = ''
    message.value = ''
    if (
      route.query.role &&
      roles.value.some((r) => r.id === route.query.role)
    ) {
      selected.value = String(route.query.role)
      populate()
      tab.value = route.query.tab === 'members' ? 'members' : 'permissions'
    }
  },
)
onMounted(() =>
  action(async () => {
    await load()
    selected.value = roles.value.some((r) => r.id === route.query.role)
      ? String(route.query.role)
      : (roles.value[0]?.id ?? '')
    permissionId.value = permissions.value.find((p) => p.implemented)?.id ?? ''
    populate()
    if (route.query.tab === 'members') tab.value = 'members'
  }),
)
</script>
<template>
  <section class="access-workspace">
    <header class="access-heading">
      <div>
        <p class="eyebrow">ACCESS MANAGEMENT</p>
        <h1>角色与权限</h1>
        <p>
          按角色配置职责，按权限核对授权。成员的有效权限由所拥有的角色共同决定。
        </p>
      </div>
      <button
        v-if="!permissionMode && auth.can('roles.manage')"
        class="button button-primary"
        :disabled="busy"
        @click="newRole"
      >
        新建角色
      </button>
    </header>
    <nav class="access-mode" aria-label="授权管理视角">
      <RouterLink to="/admin/roles"
        >角色管理<span>配置权限与成员</span></RouterLink
      ><RouterLink to="/admin/permissions"
        >权限查询<span>查看来源与拥有者</span></RouterLink
      >
    </nav>
    <p v-if="message" role="status" class="operation-message">{{ message }}</p>
    <div class="access-layout">
      <aside class="access-sidebar">
        <label class="access-search"
          >{{ permissionMode ? '查找权限' : '查找角色'
          }}<input
            v-model="search"
            :placeholder="
              permissionMode ? '权限名称或功能分组' : '角色名称或描述'
            " /></label
        ><template v-if="permissionMode"
          ><div v-for="group in groups" :key="group" class="access-catalog">
            <h3>{{ group }}</h3>
            <button
              v-for="p in visiblePermissions.filter((p) => p.group === group)"
              :key="p.id"
              :class="{ active: permissionId === p.id }"
              @click="permissionId = p.id"
            >
              {{ p.name }}
            </button>
          </div></template
        ><template v-else
          ><button
            v-for="r in visibleRoles"
            :key="r.id"
            class="access-role"
            :class="{ active: selected === r.id }"
            @click="choose(r.id)"
          >
            <span
              ><strong>{{ r.name }}</strong
              ><small>{{
                r.super ? '系统保护' : r.builtin ? '内置角色' : '自定义角色'
              }}</small></span
            ><span class="access-count">{{ r.memberCount }} 人</span>
          </button>
          <p v-if="!visibleRoles.length" class="access-note">
            没有匹配的角色
          </p></template
        >
      </aside>
      <main class="access-detail">
        <template v-if="permissionMode && capability"
          ><header>
            <p class="access-kicker">{{ capability.group }}</p>
            <h2>{{ capability.name }}</h2>
            <p class="access-note">
              以下角色可以授予此权限；超级管理员始终具有全部权限。添加成员时请选择授予该权限的角色。
            </p>
          </header>
          <div class="access-sources">
            <RouterLink
              v-for="r in granting"
              :key="r.id"
              :to="{
                path: '/admin/roles',
                query: { role: r.id, tab: 'members' },
              }"
              >{{ r.name }}
              <span
                >{{ r.memberCount }} 人{{ r.super ? ' · 系统保护' : '' }}</span
              ></RouterLink
            >
            <p v-if="!granting.length">
              尚未有角色配置此权限，请先在角色管理中配置。
            </p>
          </div>
          <h3>拥有此权限的成员</h3>
          <AccessMembers
            scope="permissions"
            :id="permissionId"
            :roles="roles"
            @changed="load"
        /></template>
        <template v-else-if="!permissionMode"
          ><header class="access-detail-heading">
            <div>
              <p class="access-kicker">
                {{
                  current?.super
                    ? '受保护角色'
                    : current?.builtin
                      ? '内置角色'
                      : '自定义角色'
                }}
              </p>
              <h2>{{ current?.name ?? '新建角色' }}</h2>
              <p class="access-note">
                {{
                  current?.description ||
                  '为明确的管理职责配置权限，再添加对应成员。'
                }}
              </p>
            </div>
            <span v-if="current" class="access-count"
              >{{ current.memberCount }} 位成员</span
            >
          </header>
          <nav class="access-tabs">
            <button
              :class="{ active: tab === 'permissions' }"
              @click="tab = 'permissions'"
            >
              权限配置</button
            ><button
              v-if="current"
              :class="{ active: tab === 'members' }"
              @click="tab = 'members'"
            >
              角色成员（{{ current.memberCount }}）
            </button>
          </nav>
          <AccessMembers
            v-if="current && tab === 'members'"
            scope="roles"
            :id="current.id"
            :roles="roles"
            @changed="load"
          />
          <form v-else class="access-role-form" @submit.prevent="save">
            <div class="access-fields">
              <label
                >角色名称<input
                  v-model="form.name"
                  maxlength="60"
                  required
                  :disabled="busy || !editable" /></label
              ><label
                >角色说明<textarea
                  v-model="form.description"
                  maxlength="300"
                  rows="2"
                  :disabled="busy || !editable"
                ></textarea>
              </label>
            </div>
            <div class="access-options">
              <strong>{{
                current?.super
                  ? '全部系统权限'
                  : `${form.permissionIds.length} 项已选权限`
              }}</strong
              ><label
                ><input type="checkbox" v-model="showIds" />显示权限标识</label
              ><label
                ><input
                  type="checkbox"
                  v-model="showReserved"
                />显示预留权限</label
              >
            </div>
            <p v-if="current?.super" class="access-note">
              超级管理员拥有全部权限，不能在此修改。成员分配仍受最后一位超级管理员保护。
            </p>
            <details
              v-for="group in groups"
              :key="group"
              class="access-permission-group"
              open
            >
              <summary>
                {{ group
                }}<span
                  >{{
                    current?.super
                      ? visiblePermissions.filter((p) => p.group === group)
                          .length
                      : visiblePermissions.filter(
                          (p) =>
                            p.group === group &&
                            form.permissionIds.includes(p.id),
                        ).length
                  }}
                  /
                  {{
                    visiblePermissions.filter((p) => p.group === group).length
                  }}</span
                >
              </summary>
              <button
                v-if="editable"
                type="button"
                class="plain-button access-group-toggle"
                :disabled="busy"
                @click="toggleGroup(group)"
              >
                切换本组全选
              </button>
              <div class="access-permission-grid">
                <label
                  v-for="p in visiblePermissions.filter(
                    (p) => p.group === group,
                  )"
                  :key="p.id"
                  ><input
                    v-if="current?.super"
                    type="checkbox"
                    checked
                    disabled
                  /><input
                    v-else
                    type="checkbox"
                    v-model="form.permissionIds"
                    :value="p.id"
                    :disabled="busy || !editable || !auth.can(p.id)"
                  /><span
                    >{{ p.name }}<small v-if="showIds">{{ p.id }}</small
                    ><small v-if="!p.implemented">预留功能</small></span
                  ></label
                >
              </div>
            </details>
            <footer class="access-save">
              <p>
                {{
                  current
                    ? `修改会影响此角色下 ${current.memberCount} 位成员的权限。`
                    : '保存角色后可添加成员。'
                }}{{ dirty ? ' 有未保存的修改。' : '' }}
              </p>
              <div class="action-row">
                <button
                  v-if="editable"
                  class="button button-primary"
                  :disabled="busy || !dirty"
                >
                  保存角色与权限</button
                ><button
                  v-if="editable && current && !current.builtin"
                  type="button"
                  class="plain-button danger"
                  :disabled="busy || current.memberCount > 0"
                  :title="current.memberCount ? '请先移除全部角色成员' : ''"
                  @click="remove"
                >
                  删除角色
                </button>
              </div>
            </footer>
          </form></template
        >
      </main>
    </div>
  </section>
</template>
<style>
.access-workspace {
  --access-line: #dce4ef;
}
.access-heading,
.access-detail-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}
.access-heading h1 {
  margin-bottom: 8px;
}
.access-heading p {
  max-width: 760px;
}
.access-mode {
  display: flex;
  gap: 8px;
  margin: 24px 0;
}
.access-mode a {
  padding: 14px 24px;
  border: 1px solid var(--access-line);
  border-radius: 8px;
  text-decoration: none;
  background: white;
}
.access-mode a.router-link-active {
  background: #102f52;
  color: white;
  border-color: #102f52;
}
.access-mode span,
.access-role small,
.access-table small {
  display: block;
  font-size: 12px;
  opacity: 0.75;
  margin-top: 4px;
}
.access-layout {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  border: 1px solid var(--access-line);
  border-radius: 12px;
  overflow: hidden;
  background: white;
}
.access-sidebar {
  padding: 20px 12px;
  background: #f6f8fc;
  border-right: 1px solid var(--access-line);
}
.access-search {
  display: grid;
  gap: 8px;
  padding: 0 8px 16px;
  font-weight: 600;
}
.access-workspace input:not([type='checkbox']),
.access-workspace select,
.access-workspace textarea,
.access-dialog input,
.access-dialog select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ccd8e6;
  border-radius: 6px;
  background: white;
  color: #173553;
  font: inherit;
  box-sizing: border-box;
}
.access-role {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 14px 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  color: #183654;
  cursor: pointer;
  margin: 4px 0;
}
.access-role.active,
.access-catalog button.active {
  background: #e4edff;
  color: #1649b7;
  box-shadow: inset 3px 0 #275ce4;
}
.access-count {
  font-size: 12px;
  white-space: nowrap;
  border-radius: 20px;
  background: #eaf0f8;
  padding: 5px 10px;
  color: #355372;
}
.access-detail {
  min-width: 0;
  padding: 28px;
}
.access-detail h2 {
  margin: 4px 0 12px;
}
.access-kicker {
  font-size: 12px;
  color: #527294;
  margin: 0;
}
.access-note {
  font-size: 13px;
  line-height: 1.8;
  color: #60758b;
}
.access-tabs {
  display: flex;
  border-bottom: 1px solid var(--access-line);
  margin: 24px 0;
}
.access-tabs button {
  background: none;
  border: 0;
  border-bottom: 3px solid transparent;
  padding: 12px 16px;
  color: #58718b;
  cursor: pointer;
}
.access-tabs button.active {
  border-color: #275ce4;
  color: #1649b7;
  font-weight: 700;
}
.access-fields {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 20px;
}
.access-fields label,
.access-dialog label {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
}
.access-options {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 18px;
  padding: 16px 0;
  font-size: 13px;
}
.access-options strong {
  margin-right: auto;
}
.access-options label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.access-permission-group {
  border: 1px solid var(--access-line);
  border-radius: 8px;
  margin: 12px 0;
  overflow: hidden;
}
.access-permission-group summary {
  padding: 14px 18px;
  background: #f7f9fc;
  font-weight: 600;
  cursor: pointer;
}
.access-permission-group summary span {
  float: right;
  font-size: 12px;
  color: #59738f;
}
.access-permission-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  padding: 16px;
  gap: 16px;
}
.access-permission-grid label {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 14px;
}
.access-permission-grid input {
  margin-top: 4px;
}
.access-permission-grid small {
  display: block;
  color: #74869a;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.access-group-toggle {
  margin: 12px 16px 0;
}
.access-save {
  border-top: 1px solid var(--access-line);
  padding-top: 16px;
  margin-top: 24px;
}
.access-save p {
  font-size: 13px;
  color: #60758b;
}
.access-catalog h3 {
  font-size: 12px;
  color: #70849b;
  padding: 12px 10px 0;
}
.access-catalog button {
  display: block;
  width: 100%;
  background: none;
  border: 0;
  text-align: left;
  padding: 10px 12px;
  border-radius: 6px;
  color: #244260;
  cursor: pointer;
}
.access-sources {
  display: grid;
  gap: 8px;
  margin: 20px 0 28px;
}
.access-sources a {
  display: flex;
  justify-content: space-between;
  padding: 12px 16px;
  border: 1px solid var(--access-line);
  border-radius: 6px;
  text-decoration: none;
}
.access-sources span {
  font-size: 12px;
  color: #657e99;
}
.access-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
}
.access-toolbar form {
  display: flex;
  gap: 8px;
  flex: 1;
}
.access-toolbar button {
  flex-shrink: 0;
  white-space: nowrap;
}
.access-toolbar input {
  min-width: 100px;
}
.access-toolbar select {
  max-width: 125px;
}
.access-table {
  overflow-x: auto;
}
.access-table table {
  width: 100%;
  border-collapse: collapse;
  min-width: 610px;
}
.access-table th,
.access-table td {
  text-align: left;
  padding: 14px 10px;
  border-bottom: 1px solid var(--access-line);
  font-size: 13px;
}
.access-table th {
  background: #f7f9fc;
  color: #60758b;
  font-weight: 500;
}
.access-tag {
  display: inline-block;
  border: 1px solid #dce5f2;
  border-radius: 4px;
  font-size: 12px;
  padding: 2px 7px;
  margin: 3px;
}
.access-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 20px;
  font-size: 12px;
}
.access-pagination span {
  margin-right: auto;
}
.access-dialog {
  border: 1px solid #dce4ef;
  border-radius: 12px;
  padding: 28px;
  width: min(500px, calc(100vw - 32px));
  box-sizing: border-box;
  color: #173553;
}
.access-dialog::backdrop {
  background: #102c4a77;
}
.access-dialog .action-row {
  margin-top: 24px;
}
.access-workspace button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
@media (max-width: 1000px) {
  .access-layout {
    grid-template-columns: 210px minmax(0, 1fr);
  }
  .access-detail {
    padding: 20px;
  }
  .access-permission-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .access-fields {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .access-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .access-mode a {
    padding: 12px;
    flex: 1;
  }
  .access-layout {
    grid-template-columns: 1fr;
  }
  .access-sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--access-line);
    max-height: 280px;
    overflow: auto;
  }
  .access-detail {
    padding: 16px;
  }
  .access-permission-grid {
    grid-template-columns: 1fr;
  }
  .access-toolbar form {
    flex-wrap: wrap;
  }
  .access-toolbar form input {
    flex-basis: 100%;
  }
  .access-pagination {
    flex-wrap: wrap;
  }
  .access-detail-heading {
    align-items: flex-start;
  }
  .access-sources a {
    flex-wrap: wrap;
    gap: 8px;
  }
}
</style>
