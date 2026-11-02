<script setup lang="ts">
import { computed } from 'vue'
import PageIntro from '../components/PageIntro.vue'
import EmptyState from '../components/EmptyState.vue'
import { contentSections, type ContentKind } from '../content'
const props = defineProps<{ kind: ContentKind }>()
const section = computed(() => contentSections[props.kind])
</script>
<template>
  <PageIntro
    :english="section.en"
    :title="section.title"
    :description="section.description"
  />
  <section class="section container content-list">
    <div class="list-toolbar">
      <h2>{{ section.label }}</h2>
      <span>{{
        kind === 'community' ? '交流功能建设中' : '等待正式发布'
      }}</span>
    </div>
    <EmptyState :title="section.empty" :description="section.note"
      ><RouterLink to="/" class="text-link"
        >返回首页 <span aria-hidden="true">↗</span></RouterLink
      ></EmptyState
    >
    <div class="list-end">
      <span>保持好奇 · 持续探索</span><span>ELECTRONIC CLUB</span>
    </div>
  </section>
</template>
