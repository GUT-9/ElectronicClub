<script setup lang="ts">
defineProps<{
  number: string
  english: string
  title: string
  to?: string
  linkText?: string
}>()
</script>
<template>
  <div class="section-heading">
    <div>
      <p class="eyebrow">
        <span>{{ number }}</span> / {{ english }}
      </p>
      <h2>{{ title }}</h2>
    </div>
    <RouterLink v-if="to" :to="to" class="text-link"
      >{{ linkText ?? '了解更多' }}
      <span aria-hidden="true">↗</span></RouterLink
    >
  </div>
</template>
