import { createRouter, createWebHistory } from 'vue-router'
import SiteLayout from './layouts/SiteLayout.vue'
export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, from, saved) {
    return saved ?? (to.hash ? { el: to.hash, top: 100 } : { top: 0 })
  },
  routes: [
    {
      path: '/',
      component: SiteLayout,
      children: [
        {
          path: '',
          component: () => import('./views/HomeView.vue'),
          meta: { title: '首页' },
        },
        {
          path: 'about',
          component: () => import('./views/AboutView.vue'),
          meta: { title: '社团介绍' },
        },
        {
          path: 'news',
          component: () => import('./views/ContentListView.vue'),
          props: { kind: 'news' },
          meta: { title: '新闻公告' },
        },
        {
          path: 'news/:id',
          component: () => import('./views/ContentDetailView.vue'),
          props: { kind: 'news' },
          meta: { title: '公告详情' },
        },
        {
          path: 'activities',
          component: () => import('./views/ContentListView.vue'),
          props: { kind: 'activities' },
          meta: { title: '活动中心' },
        },
        {
          path: 'activities/:id',
          component: () => import('./views/ContentDetailView.vue'),
          props: { kind: 'activities' },
          meta: { title: '活动详情' },
        },
        {
          path: 'community',
          component: () => import('./views/ContentListView.vue'),
          props: { kind: 'community' },
          meta: { title: '电子社区' },
        },
        {
          path: 'community/:id',
          component: () => import('./views/ContentDetailView.vue'),
          props: { kind: 'community' },
          meta: { title: '帖子详情' },
        },
        {
          path: 'login',
          component: () => import('./views/LoginView.vue'),
          meta: { title: '登录' },
        },
        {
          path: ':pathMatch(.*)*',
          component: () => import('./views/NotFoundView.vue'),
          meta: { title: '页面未找到' },
        },
      ],
    },
    {
      path: '/admin',
      component: () => import('./views/AdminView.vue'),
      meta: { title: '管理后台 · 布局预览' },
    },
  ],
})
router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? '首页')} · 电子俱乐部`
})
