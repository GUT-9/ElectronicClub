import { defineStore } from 'pinia'
import { ref } from 'vue'
import { request } from '../member-api'
export const useDeliveryStore = defineStore('delivery', () => {
  const mode = ref<'database' | 'qiniu' | 'unknown'>('unknown')
  let loading: Promise<void> | undefined
  async function restore() {
    if (mode.value !== 'unknown') return
    if (!loading) loading = request<{ mode: 'database' | 'qiniu' }>('/public-site/config')
      .then((data) => { mode.value = data.mode }).catch(() => { /* Explicit member actions still work. */ })
      .finally(() => { loading = undefined })
    await loading
  }
  return { mode, restore }
})
