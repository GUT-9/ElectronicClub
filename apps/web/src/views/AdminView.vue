<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '../stores/auth'
import { FORUM_PERMISSIONS } from '../forum'
const auth = useAuthStore()
const sections = computed(() =>
  [
    {
      title: '内容与活动',
      description: '发布社团动态，安排活动、报名与签到。',
      links: [
        {
          to: '/admin/events',
          name: '活动与报名',
          detail: '活动发布、报名名单、签到管理',
          visible: true,
        },
        {
          to: '/admin/articles',
          name: '新闻公告',
          detail: '编辑文章、审核发布与撤回',
          visible: [
            'articles.create',
            'articles.edit',
            'articles.publish',
            'articles.delete',
          ].some(auth.can),
        },
        {
          to: '/admin/popups',
          name: '全站弹窗',
          detail: '设置展示时间和关联内容',
          visible: auth.can('announcements.popup.manage'),
        },
      ],
    },
    {
      title: '电子社区',
      description: '维护版块与讨论秩序，及时处理成员反馈。',
      links: [
        {
          to: '/community',
          name: '浏览社区',
          detail: '查看讨论与项目分享',
          visible: true,
        },
        {
          to: '/admin/forum',
          name: '社区管理',
          detail: '版块、帖子、评论、举报与发言限制',
          visible: FORUM_PERMISSIONS.some(auth.can),
        },
      ],
    },
    {
      title: '成员与授权',
      description: '维护成员档案，按职责分配角色。',
      links: [
        {
          to: '/admin/members',
          name: '成员列表',
          detail: '查询成员、编辑资料和管理账号',
          visible: auth.can('members.read'),
        },
        {
          to: '/admin/imports',
          name: '批量导入',
          detail: '下载模板并导入 Excel 成员资料',
          visible: auth.can('members.import'),
        },
        {
          to: '/admin/roles',
          name: '角色管理',
          detail: '配置角色权限，直接添加或移除成员',
          visible: auth.can('roles.read'),
        },
        {
          to: '/admin/permissions',
          name: '权限查询',
          detail: '查看有效权限的拥有者及授予来源',
          visible: auth.can('roles.read'),
        },
        {
          to: '/admin/login-history',
          name: '登录记录',
          detail: '查看成员登录时间、IP 与设备信息',
          visible: auth.can('security.logins.read'),
        },
        {
          to: '/admin/audit',
          name: '操作审计',
          detail: '追踪管理操作与授权变更',
          visible: auth.can('audit.read'),
        },
      ],
    },
  ]
    .map((s) => ({ ...s, links: s.links.filter((l) => l.visible) }))
    .filter((s) => s.links.length),
)
</script>
<template>
  <section class="workspace-overview">
    <p class="eyebrow">CLUB WORKSPACE</p>
    <h1>管理工作台</h1>
    <p class="workspace-welcome">
      你好，{{ auth.member?.nickname }}。从这里开始管理社团内容与成员服务。
    </p>
    <section
      v-for="section in sections"
      :key="section.title"
      class="workspace-section"
    >
      <header>
        <h2>{{ section.title }}</h2>
        <p>{{ section.description }}</p>
      </header>
      <div class="workspace-shortcuts">
        <RouterLink v-for="link in section.links" :key="link.to" :to="link.to"
          ><span
            ><strong>{{ link.name }}</strong
            ><small>{{ link.detail }}</small></span
          ><span aria-hidden="true">→</span></RouterLink
        >
      </div>
    </section>
    <aside class="workspace-security">
      <strong>账号安全提醒</strong>
      <p>
        新成员首次登录需修改初始密码。重置密码或调整成员角色会使其旧会话失效；重要管理操作可在审计记录中追踪。
      </p>
    </aside>
  </section>
</template>
<style scoped>
.workspace-welcome {
  color: var(--muted);
  line-height: 1.8;
}
.workspace-section {
  margin: 32px 0;
}
.workspace-section header h2 {
  font-size: 20px;
  margin: 0 0 8px;
}
.workspace-section header p {
  font-size: 13px;
  color: var(--muted);
}
.workspace-shortcuts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}
.workspace-shortcuts a {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  padding: 22px;
  background: white;
  border: 1px solid var(--line);
  border-radius: 8px;
  text-decoration: none;
  color: var(--ink);
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.workspace-shortcuts a:hover {
  border-color: var(--blue);
  box-shadow: 0 4px 15px #193b5c0a;
}
.workspace-shortcuts strong {
  font-size: 16px;
}
.workspace-shortcuts small {
  display: block;
  margin-top: 8px;
  color: var(--muted);
  line-height: 1.6;
}
.workspace-security {
  border-left: 3px solid var(--blue);
  background: #eaf1fc;
  padding: 18px 22px;
  margin-top: 32px;
  border-radius: 0 8px 8px 0;
}
.workspace-security p {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.9;
  margin-bottom: 0;
}
@media (max-width: 700px) {
  .workspace-shortcuts {
    grid-template-columns: 1fr;
  }
  .workspace-shortcuts a {
    padding: 18px;
  }
}
</style>
