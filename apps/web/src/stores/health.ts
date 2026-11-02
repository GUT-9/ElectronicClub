import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getHealth, HealthCheckError } from '../api'
export const useHealthStore = defineStore('health', () => {
  const loading = ref(false)
  const status = ref('尚未检查')
  const healthy = ref(false)
  const endpoint = ref('')
  async function check() {
    if (loading.value) return
    loading.value = true
    endpoint.value = ''
    try {
      await getHealth()
      healthy.value = true
      status.value = '后端连接正常'
    } catch (error) {
      healthy.value = false
      status.value =
        error instanceof HealthCheckError
          ? error.message
          : 'API 地址配置无效或检查失败'
      endpoint.value = error instanceof HealthCheckError ? error.endpoint : ''
    } finally {
      loading.value = false
    }
  }
  return { loading, status, healthy, endpoint, check }
})
