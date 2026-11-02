<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import BrandLogo from '../components/BrandLogo.vue'
import { useAuthStore } from '../stores/auth'
const auth = useAuthStore()
onMounted(() => {
  void auth.restore().catch(() => undefined)
})
import HealthStatus from '../components/HealthStatus.vue'
const route = useRoute()
const menuOpen = ref(false)
const links = [
  { to: '/', label: '首页' },
  { to: '/about', label: '社团介绍' },
  { to: '/news', label: '新闻公告' },
  { to: '/activities', label: '活动中心' },
  { to: '/community', label: '电子社区' },
]
watch(
  () => route.path,
  () => {
    menuOpen.value = false
  },
)
</script>
<template>
  <a class="skip-link" href="#main-content">跳转到正文</a>
  <header class="site-header">
    <div class="container header-inner">
      <RouterLink to="/" class="brand" aria-label="电子俱乐部首页"
        ><BrandLogo /><span class="brand-name"
          >电子俱乐部<small>ELECTRONIC CLUB · 1991</small></span
        ></RouterLink
      >
      <button
        class="menu-toggle"
        :aria-expanded="menuOpen"
        aria-controls="site-nav"
        @click="menuOpen = !menuOpen"
      >
        {{ menuOpen ? '关闭' : '菜单' }}
        <span aria-hidden="true">{{ menuOpen ? '×' : '☰' }}</span>
      </button>
      <nav
        id="site-nav"
        aria-label="主导航"
        :class="{ 'is-open': menuOpen }"
        @keydown.esc="menuOpen = false"
      >
        <RouterLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          :class="{
            active:
              link.to === '/'
                ? route.path === '/'
                : route.path.startsWith(link.to),
          }"
          :aria-current="
            (
              link.to === '/'
                ? route.path === '/'
                : route.path.startsWith(link.to)
            )
              ? 'page'
              : undefined
          "
          >{{ link.label }}</RouterLink
        ><RouterLink :to="auth.member ? '/account' : '/login'" class="nav-login"
          >{{ auth.member ? '用户中心' : '登录' }}
          <span aria-hidden="true">↗</span></RouterLink
        >
      </nav>
    </div>
  </header>
  <main id="main-content" tabindex="-1"><RouterView /></main>
  <footer class="site-footer">
    <div class="container">
      <div class="footer-main">
        <div>
          <RouterLink to="/" class="brand"
            ><BrandLogo /><span class="brand-name"
              >电子俱乐部<small>ELECTRONIC CLUB</small></span
            ></RouterLink
          >
          <p>始于 1991，保持探索。</p>
        </div>
        <div class="footer-info">
          <p>成立于 1991 年</p>
          <p>挂靠物理与电子科学学院</p>
        </div>
        <div class="footer-links">
          <RouterLink to="/about">社团介绍</RouterLink
          ><RouterLink to="/news">新闻公告</RouterLink
          ><RouterLink to="/community">电子社区</RouterLink>
        </div>
      </div>
      <div class="footer-bottom">
        <span>电子技术 · 工程实践 · 创新精神</span><HealthStatus />
      </div>
    </div>
  </footer>
</template>
