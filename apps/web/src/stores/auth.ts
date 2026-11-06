import { normalizeStudentId } from '@electronic-club/shared'
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Identity } from '@electronic-club/shared'
import { request, RequestError } from '../member-api'
export const useAuthStore = defineStore('auth', () => {
  const identity = ref<Identity | null>(null)
  const restored = ref(false)
  const member = computed(() => identity.value?.member ?? null)
  function can(permission: string) {
    return Boolean(
      identity.value?.super || identity.value?.permissions.includes(permission),
    )
  }
  async function restore(force = false) {
    if (restored.value && !force) return
    try {
      identity.value = await request<Identity>('/auth/me')
      restored.value = true
    } catch (error) {
      identity.value = null
      if (error instanceof RequestError && error.status === 401) {
        restored.value = true
        return
      }
      throw error
    }
  }
  async function login(studentId: string, password: string) {
    clear()
    await request<Identity>('/auth/login', 'POST', {
      studentId: normalizeStudentId(studentId),
      password,
    })
    try {
      identity.value = await request<Identity>('/auth/me')
      restored.value = true
    } catch (error) {
      clear()
      if (error instanceof RequestError && error.status === 401)
        throw new Error(
          '账号密码已验证，但浏览器未能恢复登录会话。可能是跨站登录 Cookie 被拦截，请联系管理员检查网站与 API 域名配置，无需关闭浏览器隐私保护。',
        )
      throw error
    }
  }

  async function logout() {
    await request('/auth/logout', 'POST', {})
    clear()
  }
  function clear() {
    identity.value = null
    restored.value = true
  }
  return { identity, member, restored, can, restore, login, logout, clear }
})
