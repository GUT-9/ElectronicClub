<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import type { Role, Permission } from '@electronic-club/shared'
import { request, allRoles } from '../member-api'
import { useAuthStore } from '../stores/auth'
const auth = useAuthStore(),
  roles = ref<Role[]>([]),
  permissions = ref<Permission[]>([]),
  selected = ref(''),
  message = ref(''),
  busy = ref(false)
const form = reactive({
  name: '',
  description: '',
  permissionIds: [] as string[],
})
const current = computed(() => roles.value.find((r) => r.id === selected.value))
const groups = computed(() => [
  ...new Set(permissions.value.map((p) => p.group)),
])
const editable = computed(
  () =>
    auth.can('roles.manage') &&
    !current.value?.super &&
    (auth.identity?.super ||
      !current.value ||
      current.value.permissionIds.every(auth.can)),
)
function select() {
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
async function load() {
  roles.value = await allRoles()
  permissions.value = await request<Permission[]>('/permissions')
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
    select()
    message.value = '角色与权限已保存，后端将于下一次请求读取最新权限'
  })
}
async function remove() {
  if (!selected.value || !window.confirm('删除这个未使用的自定义角色？')) return
  await action(async () => {
    await request(`/roles/${selected.value}`, 'DELETE', {})
    selected.value = ''
    await load()
    select()
    message.value = '已删除'
  })
}
onMounted(() => action(load))
</script>
<template>
  <p class="eyebrow">DYNAMIC ACCESS CONTROL</p>
  <h1>{{ $route.path.endsWith('permissions') ? '权限配置' : '角色管理' }}</h1>
  <p>
    职位与权限角色分开记录。成员可以拥有多个角色，权限取并集；超级管理员角色受系统保护。
  </p>
  <p v-if="message" role="status" class="operation-message">{{ message }}</p>
  <div class="roles-layout">
    <aside>
      <label
        >选择角色<select v-model="selected" @change="select">
          <option value="">新建自定义角色</option>
          <option v-for="role in roles" :key="role.id" :value="role.id">
            {{ role.name }}（{{ role.memberCount }} 人）
          </option>
        </select></label
      >
      <p v-if="current">
        {{ current.builtin ? '初始角色' : '自定义角色' }} ·
        {{ current.super ? '系统保护' : '动态权限' }}
      </p>
    </aside>
    <form class="member-form" @submit.prevent="save">
      <label
        >角色名称<input
          v-model="form.name"
          maxlength="60"
          required
          :disabled="busy || !editable" /></label
      ><label
        >描述<textarea
          v-model="form.description"
          maxlength="300"
          :disabled="busy || !editable"
        ></textarea>
      </label>
      <fieldset v-for="group in groups" :key="group">
        <legend>{{ group }}</legend>
        <div class="permission-grid">
          <label
            v-for="permission in permissions.filter((p) => p.group === group)"
            :key="permission.id"
            ><input
              type="checkbox"
              v-model="form.permissionIds"
              :value="permission.id"
              :disabled="busy || !editable || !auth.can(permission.id)"
            /><span
              >{{ permission.name
              }}<small
                >{{ permission.id
                }}{{ permission.implemented ? '' : ' · 仅权限定义' }}</small
              ></span
            ></label
          >
        </div>
      </fieldset>
      <p v-if="current?.super">超级管理员的权限由系统保护，不允许在此编辑。</p>
      <div class="action-row">
        <button v-if="editable" class="button button-primary" :disabled="busy">
          保存角色及权限</button
        ><button
          v-if="
            editable && current && !current.builtin && current.memberCount === 0
          "
          type="button"
          class="plain-button danger"
          :disabled="busy"
          @click="remove"
        >
          删除角色
        </button>
      </div>
    </form>
  </div>
</template>
