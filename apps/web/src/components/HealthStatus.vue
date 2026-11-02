<script setup lang="ts">
import { ElButton } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import { useHealthStore } from '../stores/health'
const health = useHealthStore()
</script>
<template>
  <section class="health-check">
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
    <details v-if="health.endpoint" class="health-diagnostic">
      <summary>连接诊断</summary>
      <p>
        实际请求：<code>{{ health.endpoint }}</code>
      </p>
      <p>健康检查不连接数据库。请先确认地址、HTTP 网关及跨域配置。</p>
    </details>
  </section>
</template>
<style scoped>
.health-check {
  min-width: 0;
  max-width: 32rem;
}
.health-status {
  flex-wrap: wrap;
}
.health-diagnostic {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.7;
}
.health-diagnostic summary {
  cursor: pointer;
}
.health-diagnostic p {
  margin: 6px 0;
}
.health-diagnostic code {
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .health-check {
    width: 100%;
  }
}
</style>
