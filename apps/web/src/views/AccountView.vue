<script setup lang="ts">
import { FORUM_PERMISSIONS } from '../forum'
import { computed, reactive, ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { request } from '../member-api'
import { beijing } from '../stage3'
const auth = useAuthStore(),
  router = useRouter(),
  message = ref(''),
  busy = ref(false),
  tab = ref('profile'),
  avatarFailed = ref(false),
  securityBusy = ref(false)
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
    ...FORUM_PERMISSIONS,
    'members.read',
    'members.create',
    'members.import',
    'roles.read',
    'roles.manage',
    'roles.assign',
    'audit.read',
    'security.logins.read',
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
watch(
  () => auth.member?.avatar,
  () => {
    avatarFailed.value = false
  },
)
async function save() {
  if (busy.value || securityBusy.value) return
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
  if (securityBusy.value || busy.value) return
  securityBusy.value = true
  try {
    await auth.logout()
    await router.push('/login')
  } catch (error) {
    message.value = (error as Error).message
  } finally {
    securityBusy.value = false
  }
}
async function revoke() {
  if (securityBusy.value || busy.value) return
  if (!window.confirm('退出所有已登录设备？')) return
  securityBusy.value = true
  try {
    await request('/auth/revoke-sessions', 'POST', {})
    auth.clear()
    await router.push('/login')
  } catch (e) {
    message.value = (e as Error).message
  } finally {
    securityBusy.value = false
  }
}
</script>
<template>
  <section v-if="auth.member" class="container member-home">
    <header class="member-home-header">
      <div class="member-home-identity">
        <img
          v-if="auth.member.avatar && !avatarFailed"
          :src="auth.member.avatar"
          alt="我的头像"
          referrerpolicy="no-referrer"
          @error="avatarFailed = true"
        /><span v-else class="member-monogram" aria-hidden="true">{{
          Array.from(auth.member.nickname)[0] || 'EC'
        }}</span>
        <div>
          <p class="eyebrow">MY ELECTRONIC CLUB</p>
          <h1>你好，{{ auth.member.nickname }}</h1>
          <p>
            {{ auth.member.college || '电子俱乐部成员'
            }}<span v-if="auth.member.className">
              · {{ auth.member.className }}</span
            >
          </p>
        </div>
      </div>
      <RouterLink v-if="hasAdmin" to="/admin" class="button button-outline"
        >管理工作台 ↗</RouterLink
      >
    </header>
    <div class="member-shortcuts">
      <RouterLink to="/community/me"
        ><span class="shortcut-mark" aria-hidden="true">01</span>
        <div><strong>我的社区</strong><small>帖子、收藏与回复通知</small></div>
        <span aria-hidden="true">→</span></RouterLink
      ><RouterLink to="/activities"
        ><span class="shortcut-mark" aria-hidden="true">02</span>
        <div><strong>探索活动</strong><small>查看安排、报名与签到</small></div>
        <span aria-hidden="true">→</span></RouterLink
      ><RouterLink to="/community/new"
        ><span class="shortcut-mark" aria-hidden="true">03</span>
        <div>
          <strong>发布讨论</strong><small>提出问题，分享你的实践</small>
        </div>
        <span aria-hidden="true">→</span></RouterLink
      >
    </div>
    <div class="member-settings">
      <nav class="member-settings-nav" aria-label="账号设置">
        <button
          v-for="item in [
            ['profile', '个人资料'],
            ['identity', '成员档案'],
            ['security', '账号安全'],
          ]"
          :key="item[0]"
          :class="{ active: tab === item[0] }"
          :aria-pressed="tab === item[0]"
          @click="tab = item[0]!"
        >
          {{ item[1] }}</button
        ><RouterLink to="/admin/events">我的活动工作区 ↗</RouterLink>
      </nav>
      <div class="member-settings-panel">
        <p v-if="message" class="ui-message" role="status">{{ message }}</p>
        <form
          v-show="tab === 'profile'"
          class="member-form profile-editor"
          @submit.prevent="save"
        >
          <header>
            <h2>个人资料</h2>
            <p>完善你的展示信息，让交流从认识彼此开始。</p>
          </header>
          <div class="profile-fields">
            <label
              >昵称<input
                id="nickname"
                v-model="form.nickname"
                required
                maxlength="60"
                :disabled="busy" /></label
            ><label
              >性别<select id="gender" v-model="form.gender" :disabled="busy">
                <option>未填写</option>
                <option>男</option>
                <option>女</option>
                <option>其他</option>
              </select></label
            ><label
              >手机号<input
                id="phone"
                v-model="form.phone"
                type="tel"
                maxlength="30"
                autocomplete="tel"
                :disabled="busy" /></label
            ><label
              >邮箱<input
                id="email"
                v-model="form.email"
                type="email"
                maxlength="200"
                autocomplete="email"
                :disabled="busy" /></label
            ><label class="profile-field-wide"
              >头像地址（选填）<input
                id="avatar"
                v-model="form.avatar"
                type="url"
                maxlength="500"
                placeholder="https://…"
                :disabled="busy"
              /><small>填写可公开访问的 HTTPS 图片地址。</small></label
            >
          </div>
          <p class="profile-privacy">
            手机号、邮箱和成员身份资料不会作为论坛公开资料展示。
          </p>
          <button
            class="button button-primary"
            :disabled="busy || securityBusy"
          >
            {{ busy ? '保存中…' : '保存资料' }}
          </button>
        </form>
        <section v-if="tab === 'identity'" class="member-archive">
          <h2>成员档案</h2>
          <p>由社团维护的成员信息。需要更正时，请联系授权管理员。</p>
          <dl class="profile-data">
            <template
              v-for="(label, key) in {
                studentId: '学号',
                name: '真实姓名',
                college: '学院',
                major: '专业',
                className: '班级',
                grade: '年级',
                position: '社团职务',
              }"
              :key="key"
              ><dt>{{ label }}</dt>
              <dd>{{ auth.member[key] || '未填写' }}</dd></template
            >
          </dl>
          <div class="member-role-summary">
            <span>当前角色</span
            ><span
              v-for="role in auth.identity?.roles"
              :key="role.id"
              class="ui-tag"
              >{{ role.name }}</span
            >
          </div>
          <details class="archive-details">
            <summary>查看账号信息</summary>
            <p>
              账号状态：{{
                { active: '正常', disabled: '已禁用', deleted: '已删除' }[
                  auth.member.status
                ]
              }}
            </p>
            <p>创建时间：{{ beijing(auth.member.createdAt) }}</p>
            <p>更新时间：{{ beijing(auth.member.updatedAt) }}</p>
            <p class="account-identifier">账号编号：{{ auth.member.uid }}</p>
          </details>
        </section>
        <section v-if="tab === 'security'" class="account-security">
          <h2>账号安全</h2>
          <p>管理密码与登录状态，保护你的成员账号。</p>
          <div class="security-setting">
            <div>
              <h3>登录密码</h3>
              <p>密码至少8位，包含字母和数字。</p>
            </div>
            <RouterLink to="/change-password" class="button button-outline"
              >修改密码</RouterLink
            >
          </div>
          <div class="security-setting">
            <div>
              <h3>退出所有设备</h3>
              <p>结束当前及其他设备上的登录，需要重新输入密码。</p>
            </div>
            <button
              class="plain-button"
              :disabled="busy || securityBusy"
              @click="revoke"
            >
              退出所有设备
            </button>
          </div>
          <div class="security-setting">
            <div>
              <h3>退出当前账号</h3>
              <p>退出后仍可以浏览公开活动、新闻和社区讨论。</p>
            </div>
            <button
              class="plain-button"
              :disabled="busy || securityBusy"
              @click="logout"
            >
              退出登录
            </button>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>
