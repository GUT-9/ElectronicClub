<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { request } from '../member-api'
const auth = useAuthStore(),
  router = useRouter(),
  message = ref(''),
  busy = ref(false)
const form = reactive({
  nickname: '',
  gender: '未填写',
  phone: '',
  email: '',
  avatar: '',
})
onMounted(() => {
  if (auth.member)
    Object.assign(
      form,
      Object.fromEntries(
        Object.keys(form).map((key) => [
          key,
          auth.member![key as keyof typeof form],
        ]),
      ),
    )
})
const hasAdmin = computed(() =>
  [
    'members.read',
    'members.create',
    'members.import',
    'roles.read',
    'roles.manage',
    'roles.assign',
    'audit.read',
    'events.delete',
    'events.registrations.review',
    'articles.delete',
    'events.create',
    'events.edit',
    'events.registrations.read',
    'events.registrations.export',
    'events.checkin.manage',
    'articles.create',
    'articles.edit',
    'articles.publish',
    'announcements.popup.manage',
  ].some(auth.can),
)
async function save() {
  busy.value = true
  message.value = ''
  try {
    await request('/profile', 'PATCH', form)
    await auth.restore(true)
    message.value = '个人资料已保存'
  } catch (e) {
    message.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
async function logout() {
  try {
    await auth.logout()
    await router.push('/login')
  } catch (error) {
    message.value = (error as Error).message
  }
}
async function revoke() {
  if (!window.confirm('退出所有已登录设备？')) return
  try {
    await request('/auth/revoke-sessions', 'POST', {})
    auth.clear()
    await router.push('/login')
  } catch (e) {
    message.value = (e as Error).message
  }
}
</script>
<template>
  <RouterLink to="/admin/events" class="text-link">我的活动工作区 →</RouterLink>
  <section class="container account-page" v-if="auth.member">
    <p class="eyebrow">MEMBER PROFILE</p>
    <img
      v-if="auth.member.avatar"
      :src="auth.member.avatar"
      class="member-avatar"
      alt="成员头像"
      referrerpolicy="no-referrer"
      loading="lazy"
      width="72"
      height="72"
    />
    <h1>你好，{{ auth.member.nickname }}</h1>
    <div class="account-grid">
      <div>
        <h2>成员档案</h2>
        <dl class="profile-data">
          <template
            v-for="(label, key) in {
              uid: 'UID',
              studentId: '学号',
              name: '真实姓名',
              college: '学院',
              major: '专业',
              className: '班级',
              grade: '年级',
              position: '社团职务',
              status: '账号状态',
              createdAt: '创建时间',
              updatedAt: '更新时间',
            }"
            :key="key"
            ><dt>{{ label }}</dt>
            <dd>{{ auth.member[key] || '未填写' }}</dd></template
          >
        </dl>
        <p>
          权限角色：{{
            auth.identity?.roles?.map((role) => role.name).join('、') ||
            '未分配'
          }}
        </p>
        <p>学号、真实姓名和身份资料如需更正，请联系授权管理员。</p>
        <div class="action-row">
          <RouterLink to="/change-password" class="text-link"
            >修改密码 →</RouterLink
          ><RouterLink v-if="hasAdmin" to="/admin" class="text-link"
            >成员管理 →</RouterLink
          >
        </div>
        <button class="plain-button" @click="revoke">撤销所有会话</button
        ><button class="plain-button" @click="logout">退出登录</button>
      </div>
      <form class="member-form" @submit.prevent="save">
        <h2>个人资料</h2>
        <label for="nickname">昵称</label
        ><input
          id="nickname"
          v-model="form.nickname"
          required
          maxlength="60"
        /><label for="gender">性别</label
        ><select id="gender" v-model="form.gender">
          <option>未填写</option>
          <option>男</option>
          <option>女</option>
          <option>其他</option></select
        ><label for="phone">手机号</label
        ><input
          id="phone"
          v-model="form.phone"
          type="tel"
          maxlength="30"
        /><label for="email">邮箱</label
        ><input
          id="email"
          v-model="form.email"
          type="email"
          maxlength="200"
        /><label for="avatar">头像 HTTPS 地址</label
        ><input id="avatar" v-model="form.avatar" type="url" maxlength="500" />
        <p role="status">{{ message }}</p>
        <button class="button button-primary" :disabled="busy">
          {{ busy ? '保存中…' : '保存个人资料' }}
        </button>
      </form>
    </div>
  </section>
</template>
