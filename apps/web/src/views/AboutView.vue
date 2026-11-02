<script setup lang="ts">
import PageIntro from '../components/PageIntro.vue'
import CircuitBoard from '../components/CircuitBoard.vue'
import SectionHeading from '../components/SectionHeading.vue'
import { club, directions } from '../content'
</script>
<template>
  <PageIntro
    english="ABOUT / EST. 1991"
    title="始于热爱，成于实践。"
    description="认识电子俱乐部，一个在动手探索中不断生长的科技创新类社团。"
  />
  <section class="section container about-story">
    <div>
      <p class="eyebrow">电子俱乐部 / ELECTRONIC CLUB</p>
      <h2>从 1991 年开始，<br />让探索成为习惯。</h2>
      <p>{{ club.intro }}</p>
      <p>{{ club.mission }}</p>
    </div>
    <CircuitBoard />
  </section>
  <section class="section container section-top-line">
    <SectionHeading
      number="01"
      english="LEARN BY MAKING"
      title="扎实技能，连接创造。"
    />
    <div class="direction-grid">
      <article v-for="item in directions" :key="item.no">
        <div class="direction-meta">
          <span>{{ item.no }}</span
          ><span>{{ item.en }}</span>
        </div>
        <h3>{{ item.title }}</h3>
        <p>{{ item.text }}</p>
      </article>
    </div>
  </section>
  <section id="competition" class="about-competition">
    <div class="container">
      <p class="eyebrow">02 / 全国大学生电子设计竞赛</p>
      <h2>以赛促学，以赛育才。</h2>
      <p>
        通过全国大学生电子设计竞赛及相关电子技术实践活动，鼓励成员将理论知识应用于实际工程项目。在设计与验证中发现问题，在协作与改进中积累经验。
      </p>
      <p class="about-note">把学习落实到每一次设计、每一轮调试和每一个作品。</p>
    </div>
  </section>
</template>
