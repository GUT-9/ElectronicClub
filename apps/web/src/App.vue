<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useAuthStore } from './stores/auth'
const auth = useAuthStore(), warning = ref('')
const showWarning = (event: Event) => { warning.value = String((event as CustomEvent).detail) }
onMounted(() => window.addEventListener('eclub-public-warning', showWarning))
onBeforeUnmount(() => window.removeEventListener('eclub-public-warning', showWarning))
</script>
<template>
  <aside v-if="warning" class="public-sync-warning" role="alert">
    {{ warning }} <RouterLink v-if="auth.identity?.super" to="/admin/public-site">检查公开发布状态</RouterLink>
    <button class="plain-button" @click="warning = ''">关闭</button>
  </aside>
  <RouterView />
</template>
<style scoped>
.public-sync-warning { position: sticky; top: 0; z-index: 500; padding: 16px 24px; background: #fff3d6; color: #674616; line-height: 1.8; }
</style>
