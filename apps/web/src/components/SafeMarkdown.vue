<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ content: string }>()
const lines = computed(() => props.content.split('\n'))
</script>
<template>
  <div class="safe-markdown">
    <template v-for="(line, i) in lines" :key="i"
      ><h2 v-if="line.startsWith('## ')">{{ line.slice(3) }}</h2>
      <h3 v-else-if="line.startsWith('### ')">{{ line.slice(4) }}</h3>
      <h2 v-else-if="line.startsWith('# ')">{{ line.slice(2) }}</h2>
      <p v-else-if="line.startsWith('- ')" class="markdown-list">
        • {{ line.slice(2) }}
      </p>
      <p v-else>{{ line || '\u00a0' }}</p></template
    >
  </div>
</template>
<style scoped>
.safe-markdown {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.9;
}
.safe-markdown p {
  margin: 0.4em 0;
}
.markdown-list {
  padding-left: 1em;
}
</style>
