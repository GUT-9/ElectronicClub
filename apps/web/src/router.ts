import { FORUM_PERMISSIONS } from './forum'
import { createRouter, createWebHistory } from 'vue-router'
import SiteLayout from './layouts/SiteLayout.vue'
import { useAuthStore } from './stores/auth'
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
          component: () => import('./views/PublicationListView.vue'),
          props: { kind: 'articles' },
          meta: { title: '新闻公告' },
        },
        {
          path: 'news/:id',
          component: () => import('./views/PublicationDetailView.vue'),
          props: { kind: 'articles' },
          meta: { title: '公告详情' },
        },
        {
          path: 'activities',
          component: () => import('./views/PublicationListView.vue'),
          props: { kind: 'events' },
          meta: { title: '活动中心' },
        },
        {
          path: 'activities/:id',
          component: () => import('./views/PublicationDetailView.vue'),
          props: { kind: 'events' },
          meta: { title: '活动详情' },
        },
        {
          path: 'community',
          component: () => import('./views/ForumIndexView.vue'),
          meta: { title: '电子社区' },
        },
        {
          path: 'community/new',
          component: () => import('./views/ForumEditorView.vue'),
          meta: { title: '发布帖子', auth: true },
        },
        {
          path: 'community/me',
          component: () => import('./views/ForumMeView.vue'),
          meta: { title: '我的社区', auth: true },
        },
        {
          path: 'community/:id/edit',
          component: () => import('./views/ForumEditorView.vue'),
          meta: { title: '编辑帖子', auth: true },
        },
        {
          path: 'community/:id',
          component: () => import('./views/ForumDetailView.vue'),
          meta: { title: '帖子详情' },
        },
        {
          path: 'account',
          component: () => import('./views/AccountView.vue'),
          meta: { title: '用户中心', auth: true },
        },
        {
          path: 'change-password',
          component: () => import('./views/PasswordView.vue'),
          meta: { title: '修改密码', auth: true },
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
      component: () => import('./layouts/AdminLayout.vue'),
      meta: { auth: true },
      children: [
        {
          path: 'forum',
          component: () => import('./views/ForumAdminView.vue'),
          meta: { title: '电子社区管理', forumAdmin: true },
        },
        {
          path: 'events',
          component: () => import('./views/Stage3AdminView.vue'),
          props: { kind: 'events' },
          meta: { title: '活动与报名管理' },
        },
        {
          path: 'articles',
          component: () => import('./views/Stage3AdminView.vue'),
          props: { kind: 'articles' },
          meta: { title: '新闻公告管理' },
        },
        {
          path: 'popups',
          component: () => import('./views/Stage3AdminView.vue'),
          props: { kind: 'popups' },
          meta: {
            title: '全站弹窗管理',
            permission: 'announcements.popup.manage',
          },
        },
        {
          path: '',
          component: () => import('./views/AdminView.vue'),
          meta: { title: '管理工作区', admin: true },
        },
        {
          path: 'members',
          component: () => import('./views/MembersView.vue'),
          meta: { title: '成员列表', permission: 'members.read' },
        },
        {
          path: 'members/new',
          component: () => import('./views/MemberEditView.vue'),
          meta: { title: '创建成员', permission: 'members.create' },
        },
        {
          path: 'members/:id',
          component: () => import('./views/MemberEditView.vue'),
          meta: { title: '成员详情', permission: 'members.read' },
        },
        {
          path: 'imports',
          component: () => import('./views/ImportView.vue'),
          meta: { title: 'Excel导入', permission: 'members.import' },
        },
        {
          path: 'roles',
          component: () => import('./views/RolesView.vue'),
          meta: { title: '角色管理', permission: 'roles.read' },
        },
        {
          path: 'permissions',
          component: () => import('./views/RolesView.vue'),
          meta: { title: '权限查询', permission: 'roles.read' },
        },
        {
          path: 'login-history',
          component: () => import('./views/LoginHistoryView.vue'),
          meta: { title: '登录记录', permission: 'security.logins.read' },
        },
        {
          path: 'audit',
          component: () => import('./views/AuditView.vue'),
          meta: { title: '操作审计', permission: 'audit.read' },
        },
      ],
    },
  ],
})
router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? '首页')} · 电子俱乐部`
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (to.meta.auth || to.path === '/login') {
    try {
      await auth.restore(true)
    } catch {
      if (to.meta.auth) return { path: '/login', query: { next: to.fullPath } }
    }
    if (to.meta.auth && !auth.member)
      return { path: '/login', query: { next: to.fullPath } }
    if (auth.member?.mustChangePassword && to.path !== '/change-password')
      return '/change-password'
    if (to.path === '/login' && auth.member) return '/account'
    if (to.meta.permission && !auth.can(String(to.meta.permission)))
      return '/account'
    if (to.meta.forumAdmin && !FORUM_PERMISSIONS.some(auth.can))
      return '/account'
    if (
      to.meta.admin &&
      ![
        ...FORUM_PERMISSIONS,
        'members.read',
        'members.create',
        'members.import',
        'roles.read',
        'roles.assign',
        'audit.read',
        'security.logins.read',
        'events.registrations.read',
        'events.registrations.review',
        'events.registrations.export',
        'events.checkin.manage',
        'events.delete',
        'articles.create',
        'articles.publish',
        'articles.delete',
        'events.create',
        'events.edit',
        'articles.edit',
        'announcements.popup.manage',
      ].some(auth.can)
    )
      return '/account'
  }
})
