<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { request } from '../member-api'
const auth = useAuthStore(),
  router = useRouter()
const oldPassword = ref(''),
  newPassword = ref(''),
  confirm = ref(''),
  busy = ref(false),
  error = ref('')
async function submit() {
  error.value = ''
  if (newPassword.value !== confirm.value) {
    error.value = '两次密码不一致'
    return
  }
  busy.value = true
  try {
    await request('/auth/password', 'POST', {
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    })
    auth.clear()
    await router.push('/login?changed=1')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section class="container account-page">
    <p class="eyebrow">ACCOUNT SECURITY</p>
    <h1>
      {{ auth.member?.mustChangePassword ? '首次登录 · 修改密码' : '修改密码' }}
    </h1>
    <p>新密码至少8位，包含字母和数字。修改后所有旧会话失效，请重新登录。</p>
    <form class="member-form narrow-form" @submit.prevent="submit">
      <label for="old-password">原密码</label
      ><input
        id="old-password"
        v-model="oldPassword"
        type="password"
        autocomplete="current-password"
        required
        maxlength="128"
      /><label for="new-password">新密码</label
      ><input
        id="new-password"
        v-model="newPassword"
        type="password"
        autocomplete="new-password"
        minlength="8"
        maxlength="128"
        required
      /><label for="confirm-password">确认新密码</label
      ><input
        id="confirm-password"
        v-model="confirm"
        type="password"
        autocomplete="new-password"
        minlength="8"
        maxlength="128"
        required
      />
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="button button-primary" :disabled="busy">
        {{ busy ? '正在更新…' : '更新密码并退出旧会话' }}
      </button>
    </form>
  </section>
</template>
