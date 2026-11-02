import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getHealth } from '../api'
export const useHealthStore = defineStore('health', () => {
  const loading = ref(false)
  const status = ref('尚未检查')
  const healthy = ref(false)
  async function check() {
    loading.value = true
    try { await getHealth(); healthy.value = true; status.value = '后端连接正常' }
    catch { healthy.value = false; status.value = '连接失败，请检查后端服务与 API 地址' }
    finally { loading.value = false }
  }
  return { loading, status, healthy, check }
})
