<script setup lang="ts">
import { ElButton, ElInput } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/input/style/css'
import CircuitBoard from '../components/CircuitBoard.vue'
</script>
<template>
  <section class="container login-page">
    <div class="login-story">
      <p class="eyebrow">WELCOME TO ELECTRONIC CLUB</p>
      <h1>连接热爱，<br />一起探索。</h1>
      <p>电子技术 · 工程实践 · 创新精神</p>
      <CircuitBoard />
    </div>
    <div class="login-panel">
      <p class="eyebrow">MEMBER ACCESS</p>
      <h2>欢迎回来</h2>
      <p class="login-note" id="login-notice">
        登录服务尚未开放。账号登录及用户中心将在后续上线，当前不收集任何账号或密码。
      </p>
      <form aria-describedby="login-notice" @submit.prevent>
        <label for="login-account">账号</label
        ><ElInput
          id="login-account"
          disabled
          placeholder="登录服务尚未开放"
          autocomplete="off"
        /><label for="login-password">密码</label
        ><ElInput
          id="login-password"
          disabled
          type="password"
          placeholder="暂不支持输入"
          autocomplete="off"
        /><ElButton disabled class="login-submit" native-type="submit"
          >登录功能建设中</ElButton
        >
      </form>
      <RouterLink to="/" class="text-link"
        >先逛逛官网 <span aria-hidden="true">↗</span></RouterLink
      >
    </div>
  </section>
</template>
