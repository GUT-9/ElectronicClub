<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { STUDENT_ID_PATTERN, normalizeStudentId } from '@electronic-club/shared'
import { useRoute, useRouter } from 'vue-router'
import type { Member, Role } from '@electronic-club/shared'
import { request, allRoles } from '../member-api'
import { useAuthStore } from '../stores/auth'
const auth = useAuthStore(),
  route = useRoute(),
  router = useRouter(),
  busy = ref(false),
  message = ref(''),
  member = ref<Member | null>(null),
  roles = ref<Role[]>([]),
  selected = ref<string[]>([])
const creating = computed(() => !route.params.id)
const form = reactive({
  studentId: '',
  name: '',
  nickname: '',
  gender: '未填写',
  college: '',
  major: '',
  className: '',
  grade: '',
  phone: '',
  email: '',
  avatar: '',
  position: '',
})
const labels = {
  studentId: '学号',
  name: '真实姓名',
  nickname: '昵称',
  college: '学院',
  major: '专业',
  className: '班级',
  grade: '年级',
  phone: '手机号',
  email: '邮箱',
  avatar: '头像 HTTPS 地址',
  position: '社团职务（独立于权限角色）',
}
async function load() {
  if (!creating.value) {
    member.value = await request<Member>(`/members/${String(route.params.id)}`)
    for (const key of Object.keys(form) as (keyof typeof form)[])
      form[key] = member.value[key]
    selected.value = [...member.value.roleIds]
  }
  if (auth.can('roles.read')) roles.value = await allRoles()
}
async function act(fn: () => Promise<void>) {
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
  await act(async () => {
    const payload = { ...form, studentId: normalizeStudentId(form.studentId) }
    if (creating.value && !payload.nickname) payload.nickname = payload.name
    const result = await request<Member>(
      creating.value ? '/members' : `/members/${member.value!.uid}`,
      creating.value ? 'POST' : 'PATCH',
      payload,
    )
    if (creating.value) await router.push(`/admin/members/${result.uid}`)
    await load()
    message.value = '已保存'
  })
}
async function operation(action: string, method: string, data?: unknown) {
  if (!member.value) return
  await act(async () => {
    member.value = await request<Member>(
      `/members/${member.value!.uid}${action ? '/' + action : ''}`,
      method,
      data,
    )
    await load()
    message.value = '操作已完成；相关旧会话已撤销'
  })
}
function reset() {
  if (
    window.confirm('将密码重置为初始激活密码、强制改密并撤销全部旧会话。继续？')
  )
    void operation('password', 'POST', {})
}
function remove() {
  if (window.confirm('软删除该成员？账号立即失效，可在后续恢复。'))
    void operation('', 'DELETE', {})
}
function anonymize() {
  if (
    window.confirm(
      '不可逆匿名化已删除成员的身份资料？导入历史将按隐私清理流程处理。',
    )
  )
    void operation('anonymize', 'POST', {})
}
onMounted(() => act(load))
</script>
<template>
  <p class="eyebrow">MEMBER IDENTITY</p>
  <h1>{{ creating ? '创建成员' : '成员详情与管理' }}</h1>
  <p v-if="member">
    UID：{{ member.uid }} · {{ member.status }} ·
    {{ member.mustChangePassword ? '待首次改密' : '已激活' }}
  </p>
  <p v-if="message" role="status" class="operation-message">{{ message }}</p>
  <form class="member-form form-grid" @submit.prevent="save">
    <label v-for="(label, key) in labels" :key="key"
      >{{ label
      }}<input
        v-model="form[key]"
        :required="key === 'studentId' || key === 'name'"
        :pattern="key === 'studentId' ? STUDENT_ID_PATTERN : undefined"
        :minlength="key === 'studentId' ? 4 : undefined"
        :maxlength="
          key === 'studentId'
            ? 24
            : key === 'avatar'
              ? 500
              : key === 'email'
                ? 200
                : 100
        "
        :disabled="
          busy ||
          (!creating && !auth.can('members.edit')) ||
          member?.status === 'deleted'
        " /></label
    ><label
      >性别<select
        v-model="form.gender"
        :disabled="busy || (!creating && !auth.can('members.edit'))"
      >
        <option>未填写</option>
        <option>男</option>
        <option>女</option>
        <option>其他</option>
      </select></label
    >
    <div class="form-wide">
      <p v-if="creating">
        账号默认普通成员，初始密码用于首次激活，昵称默认与真实姓名一致。
      </p>
      <button
        v-if="creating ? auth.can('members.create') : auth.can('members.edit')"
        class="button button-primary"
        :disabled="busy || member?.status === 'deleted'"
      >
        {{ busy ? '处理中…' : '保存成员' }}
      </button>
    </div>
  </form>
  <section v-if="member" class="admin-empty">
    <h2>角色与账号安全</h2>
    <div v-if="auth.can('roles.assign') && roles.length" class="role-checks">
      <label v-for="role in roles" :key="role.id"
        ><input
          type="checkbox"
          v-model="selected"
          :value="role.id"
          :disabled="
            busy ||
            (!auth.identity?.super &&
              (role.super || !role.permissionIds.every(auth.can)))
          "
        />{{ role.name }}</label
      ><button
        class="plain-button"
        :disabled="busy"
        @click="operation('roles', 'PUT', { roleIds: selected })"
      >
        保存角色分配
      </button>
    </div>
    <div class="action-row">
      <button
        v-if="auth.can('members.password') && member.status !== 'deleted'"
        class="plain-button"
        :disabled="busy"
        @click="reset"
      >
        重置密码并撤销旧会话</button
      ><button
        v-if="auth.can('members.status') && member.status !== 'deleted'"
        class="plain-button"
        :disabled="busy"
        @click="
          operation('status', 'PATCH', {
            status: member.status === 'active' ? 'disabled' : 'active',
          })
        "
      >
        {{ member.status === 'active' ? '禁用账号' : '恢复账号' }}</button
      ><button
        v-if="auth.can('members.delete') && member.status !== 'deleted'"
        class="plain-button danger"
        :disabled="busy"
        @click="remove"
      >
        软删除成员</button
      ><button
        v-if="
          auth.can('members.delete') &&
          member.status === 'deleted' &&
          !member.anonymizedAt
        "
        class="plain-button"
        :disabled="busy"
        @click="operation('restore', 'POST', {})"
      >
        恢复为禁用账号</button
      ><button
        v-if="
          auth.identity?.super &&
          member.status === 'deleted' &&
          !member.anonymizedAt
        "
        class="plain-button danger"
        :disabled="busy"
        @click="anonymize"
      >
        不可逆匿名化
      </button>
    </div>
  </section>
</template>
