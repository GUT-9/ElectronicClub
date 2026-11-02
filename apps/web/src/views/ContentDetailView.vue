<script setup lang="ts">
import { computed } from 'vue'
import EmptyState from '../components/EmptyState.vue'
import { contentSections, type ContentKind } from '../content'
const props = defineProps<{ kind: ContentKind }>()
const section = computed(() => contentSections[props.kind])
</script>
<template>
  <section class="container detail-page">
    <nav class="breadcrumb" aria-label="面包屑">
      <RouterLink to="/">首页</RouterLink><span>/</span
      ><RouterLink :to="section.link">{{ section.title }}</RouterLink
      ><span>/</span><span>{{ section.unit }}详情</span>
    </nav>
    <div class="detail-grid">
      <article class="detail-body">
        <p class="eyebrow">{{ section.en }}</p>
        <h1>暂无可展示的{{ section.unit }}</h1>
        <EmptyState
          :title="`未找到该${section.unit}`"
          :description="`该${section.unit}尚未发布或不存在。`"
          ><RouterLink :to="section.link" class="button button-primary"
            >返回{{ section.title }}
            <span aria-hidden="true">↗</span></RouterLink
          ></EmptyState
        >
      </article>
      <aside class="detail-aside">
        <span class="eyebrow">ELECTRONIC CLUB</span>
        <h2>{{ section.title }}</h2>
        <p>{{ section.description }}</p>
        <RouterLink :to="section.link" class="text-link"
          >查看全部{{ section.unit }} →</RouterLink
        >
      </aside>
    </div>
  </section>
</template>
