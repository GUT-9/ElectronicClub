<script setup lang="ts">
import { ElButton } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import { useHealthStore } from '../stores/health'
const health = useHealthStore()
</script>
<template>
  <div class="health-status">
    <div>
      <span
        class="status-dot"
        :class="{ 'status-dot--online': health.healthy }"
      ></span
      ><span role="status" aria-live="polite">{{ health.status }}</span>
    </div>
    <ElButton text :loading="health.loading" @click="health.check"
      >检查服务连接</ElButton
    >
  </div>
</template>
