<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '../stores/auth'
import BrandLogo from '../components/BrandLogo.vue'
const auth = useAuthStore()
const links = computed(() =>
  [
    { to: '/admin/events', label: '活动与报名', permission: '' },
    { to: '/admin/articles', label: '新闻公告', permission: '' },
    {
      to: '/admin/popups',
      label: '全站弹窗',
      permission: 'announcements.popup.manage',
    },
    { to: '/admin', label: '工作概览', permission: '' },
    { to: '/admin/members', label: '成员列表', permission: 'members.read' },
    {
      to: '/admin/members/new',
      label: '创建成员',
      permission: 'members.create',
    },
    {
      to: '/admin/imports',
      label: 'Excel 批量导入',
      permission: 'members.import',
    },
    { to: '/admin/roles', label: '角色管理', permission: 'roles.read' },
    { to: '/admin/permissions', label: '权限配置', permission: 'roles.read' },
    { to: '/admin/audit', label: '操作审计', permission: 'audit.read' },
  ].filter((item) =>
    item.to === '/admin/articles'
      ? [
          'articles.create',
          'articles.edit',
          'articles.publish',
          'articles.delete',
        ].some(auth.can)
      : !item.permission || auth.can(item.permission),
  ),
)
</script>
<template>
  <div class="admin-shell">
    <aside class="admin-sidebar">
      <RouterLink to="/" class="brand"
        ><BrandLogo /><span class="brand-name"
          >电子俱乐部<small>社团管理工作区</small></span
        ></RouterLink
      >
      <p class="eyebrow">WORKSPACE</p>
      <nav aria-label="管理导航">
        <RouterLink
          v-for="item in links"
          :key="item.to"
          :to="item.to"
          :class="{ active: $route.path === item.to }"
          >{{ item.label }} <span>↗</span></RouterLink
        >
      </nav>
      <RouterLink to="/account" class="text-link">← 用户中心</RouterLink>
    </aside>
    <main class="admin-main">
      <header class="admin-header">
        <span>{{ $route.meta.title }}</span
        ><RouterLink to="/account">{{ auth.member?.nickname }}</RouterLink>
      </header>
      <div class="admin-content"><RouterView :key="$route.path" /></div>
    </main>
  </div>
</template>
