<script setup lang="ts">
defineProps<{ title: string; description: string; compact?: boolean }>()
</script>
<template>
  <div class="empty-state" :class="{ 'empty-state--compact': compact }">
    <span class="empty-rule" aria-hidden="true"></span>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <slot />
  </div>
</template>
