<script setup lang="ts">
import { officialLogo as logo } from '../brand'
</script>
<template>
  <span class="brand-logo" :class="{ 'brand-logo--pending': !logo }">
    <img
      v-if="logo"
      :src="logo"
      alt="电子俱乐部正式标志"
      width="80"
      height="80"
    />
    <span
      v-else
      class="logo-pending"
      role="img"
      aria-label="正式 Logo 原图待提供"
      >Logo<br /><small>原图待补充</small></span
    >
  </span>
</template>
