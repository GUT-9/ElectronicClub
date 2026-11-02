<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import CircuitBoard from '../components/CircuitBoard.vue'
const auth = useAuthStore(),
  router = useRouter(),
  route = useRoute()
const studentId = ref(''),
  password = ref(''),
  busy = ref(false),
  error = ref('')
async function submit() {
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
        使用学号和密码登录。首次登录须先修改初始密码，才能使用成员功能。
      </p>
      <form class="member-form" @submit.prevent="submit">
        <label for="student-id">学号</label
        ><input
          id="student-id"
          v-model="studentId"
          inputmode="numeric"
          autocomplete="username"
          required
          maxlength="24"
        /><label for="password">密码</label
        ><input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          maxlength="128"
        />
        <p v-if="error" role="alert" class="form-error">{{ error }}</p>
        <button class="button button-primary" :disabled="busy">
          {{ busy ? '正在登录…' : '登录' }}
        </button>
      </form>
      <RouterLink to="/" class="text-link">返回官网 ↗</RouterLink>
    </div>
  </section>
</template>
