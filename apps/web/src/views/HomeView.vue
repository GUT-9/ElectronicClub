<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { ClubEvent, ClubArticle, Page } from '@electronic-club/shared'
import { request } from '../member-api'
import { beijing } from '../stage3'
import PopupNotice from '../components/PopupNotice.vue'
import BrandLogo from '../components/BrandLogo.vue'
import CircuitBoard from '../components/CircuitBoard.vue'
import SectionHeading from '../components/SectionHeading.vue'
import EmptyState from '../components/EmptyState.vue'
import { club, directions } from '../content'
const recentEvents = ref<ClubEvent[]>([]),
  recentNews = ref<ClubArticle[]>([]),
  contentError = ref('')
onMounted(async () => {
  const results = await Promise.allSettled([
    request<Page<ClubEvent>>('/public/events?pageSize=3'),
    request<Page<ClubArticle>>('/public/articles?pageSize=3'),
  ])
  const events = results[0],
    articles = results[1]
  if (events.status === 'fulfilled') recentEvents.value = events.value.items
  else contentError.value = '动态暂时无法加载，请稍后重试'
  if (articles.status === 'fulfilled') recentNews.value = articles.value.items
  else contentError.value = '动态暂时无法加载，请稍后重试'
})
</script>
<template>
  <PopupNotice />
  <section class="home-hero">
    <div class="container">
      <div class="hero-meta">
        <span class="eyebrow">ELECTRONIC CLUB / EST. 1991</span
        ><span>物理与电子科学学院</span>
      </div>
      <div class="hero-grid">
        <div class="hero-copy">
          <p class="hero-overline">让每一份好奇，都有实践的回响。</p>
          <h1>
            电子俱乐部<span
              >连接想法，<br />创造<span class="blue-word">可能。</span></span
            >
          </h1>
          <p class="hero-description">
            探索电子技术，打磨工程技能。<br />从第一个焊点出发，让理论在实践中生长。
          </p>
          <div class="hero-actions">
            <RouterLink class="button button-primary" to="/about"
              >认识电子俱乐部 <span aria-hidden="true">↗</span></RouterLink
            ><RouterLink class="text-link" to="/activities"
              >探索社团活动 <span aria-hidden="true">→</span></RouterLink
            >
          </div>
        </div>
        <div class="hero-visual">
          <CircuitBoard />
          <div class="hero-caption">
            <BrandLogo /><span
              >求知于理，实践于行。<small
                >电子技术与创新实践的探索空间</small
              ></span
            >
          </div>
        </div>
      </div>
      <div class="hero-bottom">
        <span>始于 1991 · 以实践回应热爱</span
        ><a href="#introduction">向下探索 <span aria-hidden="true">↓</span></a>
      </div>
    </div>
  </section>
  <section id="introduction" class="section container">
    <SectionHeading
      number="01"
      english="WHO WE ARE"
      title="不止于理解，更在于创造。"
      to="/about"
      link-text="关于社团"
    />
    <div class="intro-columns">
      <p class="intro-lead">
        一份对电子技术的兴趣，<br />一段从知识到作品的旅程。
      </p>
      <div>
        <p>{{ club.intro }}</p>
        <p>{{ club.mission }}</p>
      </div>
    </div>
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
  <section class="competition-section">
    <div class="container competition-grid">
      <div>
        <p class="eyebrow">02 / LEARN THROUGH COMPETITION</p>
        <p class="competition-mark" aria-hidden="true">
          以赛促学<br /><span>以赛育才</span>
        </p>
      </div>
      <div class="competition-copy">
        <span class="label">重点赛事 · 电赛</span>
        <h2>全国大学生<br />电子设计竞赛</h2>
        <p>
          以电子设计为纽带，把课堂所学带入实际工程。社团通过电赛及相关电子技术实践活动，鼓励成员在设计、制作与调试中提升工程实践能力与创新能力。
        </p>
        <RouterLink to="/about#competition" class="text-link"
          >了解我们的实践理念 <span aria-hidden="true">↗</span></RouterLink
        >
      </div>
    </div>
  </section>
  <section class="section container">
    <SectionHeading
      number="03"
      english="HANDS-ON EXPLORATION"
      title="在实践中，遇见新的可能。"
      to="/activities"
      link-text="活动中心"
    />
    <div class="activity-empty">
      <div class="activity-annotation">
        <span class="label">社团活动</span>
        <h3>把知识接入现实。</h3>
        <p>焊接、测量、设计、制作。<br />每一个步骤，都是新的探索。</p>
      </div>
      <div v-if="recentEvents.length">
        <article
          v-for="event in recentEvents"
          :key="event.id"
          class="publication-row"
        >
          <div>
            <p class="eyebrow">{{ beijing(event.startsAt) }}</p>
            <h3>
              <RouterLink :to="`/activities/${event.id}`">{{
                event.title
              }}</RouterLink>
            </h3>
            <p>{{ event.summary }}</p>
          </div>
        </article>
      </div>
      <EmptyState
        v-else
        compact
        :title="contentError || '暂无近期活动'"
        description="活动安排确认后，将在这里发布。"
      />
    </div>
  </section>
  <section class="news-section">
    <div class="container">
      <SectionHeading
        number="04"
        english="NEWS & NOTICES"
        title="社团新鲜事"
        to="/news"
        link-text="全部公告"
      />
      <div class="news-empty-row">
        <span class="news-column-label">最新公告</span>
        <div v-if="recentNews.length">
          <article
            v-for="article in recentNews"
            :key="article.id"
            class="publication-row"
          >
            <div>
              <p class="eyebrow">{{ beijing(article.publishedAt) }}</p>
              <h3>
                <RouterLink :to="`/news/${article.id}`">{{
                  article.title
                }}</RouterLink>
              </h3>
              <p>{{ article.summary }}</p>
            </div>
          </article>
        </div>
        <EmptyState
          v-else
          compact
          :title="contentError || '暂无新闻公告'"
          description="关注这里，了解社团的下一步动态。"
        />
      </div>
    </div>
  </section>
  <section class="community-section container">
    <div>
      <p class="eyebrow">05 / SHARE THE CURIOSITY</p>
      <h2>一个想法，<br />从交流中开始。</h2>
      <p>
        讨论电路，分享调试思路，记录实践中的发现。<br />电子社区，连接每一个热爱探索的你。
      </p>
      <RouterLink class="button button-primary" to="/community"
        >前往电子社区 <span aria-hidden="true">↗</span></RouterLink
      >
    </div>
    <div class="community-type" aria-hidden="true">
      <span>THINK.</span><span>BUILD.</span
      ><span class="type-outline">SHARE<span class="red-word">.</span></span
      ><small>好奇心，是共同的语言。</small>
    </div>
  </section>
</template>
