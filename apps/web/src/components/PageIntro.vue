<script setup lang="ts">
defineProps<{ english: string; title: string; description: string }>()
</script>
<template>
  <section class="page-intro">
    <div class="container">
      <p class="eyebrow">{{ english }}</p>
      <h1>{{ title }}</h1>
      <p class="page-description">{{ description }}</p>
    </div>
  </section>
</template>
