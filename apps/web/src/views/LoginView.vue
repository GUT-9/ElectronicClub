<script setup lang="ts">
import { ref } from 'vue'
import { STUDENT_ID_PATTERN } from '@electronic-club/shared'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import CircuitBoard from '../components/CircuitBoard.vue'
const auth = useAuthStore(),
  router = useRouter(),
  route = useRoute()
const studentId = ref(''),
  password = ref(''),
  busy = ref(false),
  error = ref(''),
  showPassword = ref(false)
async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await auth.login(studentId.value, password.value)
    password.value = ''
    const next = String(route.query.next ?? '/account')
    await router.push(
      auth.member?.mustChangePassword
        ? '/change-password'
        : next.startsWith('/') && !next.startsWith('//')
          ? next
          : '/account',
    )
  } catch (e) {
    error.value = (e as Error).message
    password.value = ''
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section class="container login-page">
    <div class="login-story">
      <p class="eyebrow">MEMBER ACCESS</p>
      <h1>连接热爱，<br />一起探索。</h1>
      <p>电子技术 · 工程实践 · 创新精神</p>
      <CircuitBoard />
    </div>
    <div class="login-panel">
      <p class="eyebrow">ELECTRONIC CLUB</p>
      <h2>成员登录</h2>
      <p v-if="route.query.changed" role="status">
        密码已更新，请使用新密码重新登录。
      </p>
      <p class="login-note">
        欢迎回来，登录后参与讨论、报名活动，继续你的实践旅程。
      </p>
      <form class="member-form" @submit.prevent="submit">
        <label for="student-id">学号</label
        ><input
          id="student-id"
          v-model="studentId"
          :pattern="STUDENT_ID_PATTERN"
          minlength="4"
          autocapitalize="characters"
          :spellcheck="false"
          autocomplete="username"
          required
          placeholder="输入学号"
          :disabled="busy"
          maxlength="24"
        /><label for="password">密码</label>
        <div class="password-input">
          <input
            id="password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            required
            maxlength="128"
            :disabled="busy"
            placeholder="输入登录密码"
          /><button
            type="button"
            class="password-toggle"
            :aria-pressed="showPassword"
            @click="showPassword = !showPassword"
          >
            {{ showPassword ? '隐藏' : '显示' }}
          </button>
        </div>
        <p v-if="error" role="alert" class="form-error">{{ error }}</p>
        <button class="button button-primary" :disabled="busy">
          {{ busy ? '正在登录…' : '登录' }}
        </button>
      </form>
      <div class="login-help">
        <strong>首次登录或忘记密码？</strong>
        <p>
          成员账号由社团统一建立，首次登录需修改初始密码。如需开通或重置密码，请联系授权管理员。
        </p>
      </div>
      <RouterLink to="/" class="text-link">返回官网 ↗</RouterLink>
    </div>
  </section>
</template>
