<script setup lang="ts">
import { useAuthStore } from '../stores/auth'
const auth = useAuthStore()
</script>
<template>
  <p class="eyebrow">MEMBER WORKSPACE</p>
  <h1>成员与权限管理</h1>
  <p>
    你好，{{
      auth.member?.nickname
    }}。请从导航选择功能。可见入口由当前权限决定，每次请求还会由服务端独立校验。
  </p>
  <section class="admin-empty">
    <h2>安全操作提示</h2>
    <p>
      新成员初始密码仅用于激活，首次登录必须修改。角色、账号状态和身份信息变更会记录审计，密码重置将撤销旧会话。
    </p>
    <p>活动、文章与社区业务仍将在后续阶段开发。</p>
  </section>
</template>
