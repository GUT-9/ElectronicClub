<script setup lang="ts">
import { FORUM_PERMISSIONS } from '../forum'
import { computed } from 'vue'
import { useAuthStore } from '../stores/auth'
import BrandLogo from '../components/BrandLogo.vue'
const auth = useAuthStore()
const navGroups = computed(() =>
  [
    { name: '工作台', paths: ['/admin'] },
    {
      name: '内容与社区',
      paths: [
        '/admin/events',
        '/admin/articles',
        '/admin/popups',
        '/admin/forum',
        '/admin/resources',
      ],
    },
    {
      name: '成员服务',
      paths: ['/admin/members', '/admin/members/new', '/admin/imports'],
    },
    {
      name: '权限与安全',
      paths: [
        '/admin/roles',
        '/admin/permissions',
        '/admin/audit',
        '/admin/login-history',
        '/admin/public-site',
      ],
    },
  ]
    .map((g) => ({
      ...g,
      items: links.value.filter((l) => g.paths.includes(l.to)),
    }))
    .filter((g) => g.items.length),
)
const links = computed(() =>
  [
    { to: '/admin/public-site', label: '公开发布与预算', permission: '' },
    {
      to: '/admin/resources',
      label: '社团资料管理',
      permission: 'resources.manage',
    },
    { to: '/admin/forum', label: '电子社区管理', permission: '' },
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
    { to: '/admin/permissions', label: '权限查询', permission: 'roles.read' },
    {
      to: '/admin/login-history',
      label: '登录记录',
      permission: 'security.logins.read',
    },
    { to: '/admin/audit', label: '操作审计', permission: 'audit.read' },
  ].filter((item) =>
    item.to === '/admin/public-site' ? !!auth.identity?.super : item.to === '/admin/forum'
      ? FORUM_PERMISSIONS.some(auth.can)
      : item.to === '/admin/articles'
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
        <section
          v-for="group in navGroups"
          :key="group.name"
          class="admin-nav-group"
        >
          <h2>{{ group.name }}</h2>
          <RouterLink
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            :class="{ active: $route.path === item.to }"
            >{{ item.label }} <span>↗</span></RouterLink
          >
        </section>
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

<style scoped>
.admin-nav-group h2 {
  font-size: 10px;
  letter-spacing: 0.12em;
  color: #7a8da5;
  margin: 20px 16px 8px;
  font-weight: 500;
}
.admin-sidebar .eyebrow {
  display: none;
}
.admin-sidebar nav a {
  padding-top: 10px;
  padding-bottom: 10px;
}
@media (max-width: 900px) {
  .admin-nav-group {
    display: contents;
  }
  .admin-nav-group h2 {
    display: none;
  }
}
</style>
