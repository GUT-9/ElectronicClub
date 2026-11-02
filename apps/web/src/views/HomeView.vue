<script setup lang="ts">
import { ElButton, ElTag } from 'element-plus'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/tag/style/css'
import { useHealthStore } from '../stores/health'
const health = useHealthStore()
const activities = [
  { number: '01', title: '电子技术基础', text: '从电路原理到动手制作，在实践中培养电子技术基本技能。' },
  { number: '02', title: '设计与创新', text: '围绕真实问题开展电子设计，让想法在探索与协作中成为作品。' },
  { number: '03', title: '学科竞赛', text: '以赛促学，将知识运用于挑战，在交流与实践中持续成长。' },
]
</script>
<template>
  <div class="site">
    <header><a class="brand" href="/">EC<span>电子俱乐部<small>ELECTRONIC CLUB</small></span></a><nav aria-label="主导航"><a href="#about">关于我们</a><a href="#practice">探索实践</a></nav></header>
    <main>
      <section class="hero"><div class="eyebrow">EST. 1991 · 想法，从这里接通</div><h1>让好奇心，<br>连接<span>无限可能。</span></h1><p>从一条电路到一个创意，在动手实践中探索电子世界。<br>电子俱乐部，与热爱同行。</p><a class="cta" href="#practice">探索我们的实践 <span>↗</span></a><div class="circuit" aria-hidden="true"><div class="chip">EC<small>CREATE · CONNECT</small></div><i></i><b></b></div><div class="hero-foot"><span>物理与电子科学学院</span><span>探索 / 实践 / 创新</span></div></section>
      <section id="about" class="about"><div class="eyebrow">ABOUT US / 关于我们</div><h2>始于 1991，<br>在实践中不断生长。</h2><p>电子俱乐部成立于1991年，挂靠物理与电子科学学院，以培养电子技术基本技能、开展电子设计与创新实践、通过学科竞赛促进学习为宗旨。</p></section>
      <section id="practice"><div class="section-title"><h2>把想法变成实践</h2><span>LEARN BY MAKING</span></div><div class="cards"><article v-for="item in activities" :key="item.number"><span class="number">{{ item.number }}</span><h3>{{ item.title }}</h3><p>{{ item.text }}</p></article></div></section>
      <section class="health"><div><h2>服务连接检查</h2><p role="status">{{ health.status }}</p></div><ElTag :type="health.healthy ? 'success' : 'info'">{{ health.healthy ? '在线' : '待验证' }}</ElTag><ElButton :loading="health.loading" @click="health.check">检查连接</ElButton></section>
    </main><footer><span>ElectronicClub · 电子俱乐部</span><span>自 1991 年起，保持探索。</span></footer>
  </div>
</template>
