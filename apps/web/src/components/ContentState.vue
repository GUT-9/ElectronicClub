<script setup lang="ts">
withDefaults(
  defineProps<{
    loading?: boolean
    error?: boolean
    title?: string
    description?: string
  }>(),
  { title: '暂无内容', description: '' },
)
defineEmits<{ retry: [] }>()
</script>
<template>
  <div
    class="content-state"
    :class="{ 'is-loading': loading }"
    :role="error ? 'alert' : 'status'"
    :aria-busy="loading"
  >
    <div v-if="loading" class="content-skeleton" aria-hidden="true">
      <i /><i /><i />
    </div>
    <template v-else
      ><span class="state-symbol" aria-hidden="true">{{
        error ? '!' : '＋'
      }}</span>
      <h3>{{ title }}</h3>
      <p v-if="description">{{ description }}</p>
      <button
        v-if="error"
        class="button button-outline"
        @click="$emit('retry')"
      >
        重新加载</button
      ><slot v-else /></template
    ><span v-if="loading" class="sr-only">正在加载内容…</span>
  </div>
</template>
<style scoped>
.content-state {
  text-align: center;
  padding: 48px 24px;
  background: #f7f9fc;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.content-state h3 {
  font-size: 19px;
  margin: 14px 0 8px;
}
.content-state p {
  font-size: 14px;
  line-height: 1.8;
  max-width: 440px;
  margin: 0 auto 20px;
}
.content-state .button {
  margin-top: 4px;
}
.state-symbol {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  margin: auto;
  border: 1px solid #cfdaeb;
  border-radius: 50%;
  color: var(--blue);
  font-size: 22px;
}
.content-skeleton {
  display: grid;
  gap: 18px;
  text-align: left;
}
.content-skeleton i {
  display: block;
  height: 18px;
  border-radius: 4px;
  background: #e3eaf3;
  animation: soft-pulse 1.4s ease-in-out infinite alternate;
}
.content-skeleton i:first-child {
  width: 45%;
  height: 24px;
}
.content-skeleton i:last-child {
  width: 70%;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
@keyframes soft-pulse {
  to {
    opacity: 0.45;
  }
}
@media (prefers-reduced-motion: reduce) {
  .content-skeleton i {
    animation: none;
  }
}
</style>
