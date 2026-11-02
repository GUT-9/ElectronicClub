<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import BrandLogo from '../components/BrandLogo.vue'
import EmptyState from '../components/EmptyState.vue'
const route = useRoute()
const sections = [
  { id: 'overview', title: '工作概览' },
  { id: 'news', title: '新闻公告' },
  { id: 'activities', title: '活动内容' },
  { id: 'community', title: '社区内容' },
]
const current = computed(
  () =>
    sections.find((item) => item.id === route.query.section) ?? sections[0]!,
)
</script>
<template>
  <div class="admin-shell">
    <aside class="admin-sidebar">
      <RouterLink to="/" class="brand"
        ><BrandLogo /><span class="brand-name"
          >电子俱乐部<small>内容管理 / 布局预览</small></span
        ></RouterLink
      >
      <p class="eyebrow">WORKSPACE</p>
      <nav aria-label="后台布局预览导航">
        <RouterLink
          v-for="item in sections"
          :key="item.id"
          :to="{ path: '/admin', query: { section: item.id } }"
          :class="{ active: current.id === item.id }"
          :aria-current="current.id === item.id ? 'page' : undefined"
          >{{ item.title }} <span aria-hidden="true">↗</span></RouterLink
        >
      </nav>
      <RouterLink to="/" class="text-link">← 返回官网</RouterLink>
    </aside>
    <main class="admin-main">
      <header class="admin-header">
        <span>管理后台 / {{ current.title }}</span
        ><span class="label">仅布局预览</span>
      </header>
      <div class="admin-content">
        <p class="eyebrow">CONTENT WORKSPACE</p>
        <h1>{{ current.title }}</h1>
        <p class="admin-notice">
          当前页面仅展示后台布局，不包含管理权限、真实数据或内容发布能力。后续接入身份验证后再开放管理操作。
        </p>
        <section class="admin-empty">
          <h2>
            {{ current.id === 'overview' ? '内容管理工作区' : current.title }}
          </h2>
          <EmptyState
            title="管理功能尚未开放"
            description="内容编辑、发布及权限控制将在后续阶段开发。"
          />
        </section>
      </div>
    </main>
  </div>
</template>
