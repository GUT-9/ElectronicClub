<script setup lang="ts">
import {imageSource} from '../media'
import { ref, watch } from 'vue'
import type { ClubEvent, ClubArticle, Page } from '@electronic-club/shared'
import { request } from '../member-api'
import { beijing } from '../stage3'
import PageIntro from '../components/PageIntro.vue'
const props = defineProps<{ kind: 'events' | 'articles' }>()
const rows = ref<(ClubEvent | ClubArticle)[]>([]),
  error = ref(''),
  search = ref(''),
  category = ref(''),
  page = ref(1),
  total = ref(0),
  loading = ref(false)
async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await request<Page<ClubEvent | ClubArticle>>(
      `/public/${props.kind}?page=${page.value}&search=${encodeURIComponent(search.value)}&category=${encodeURIComponent(category.value)}`,
    )
    rows.value = data.items
    total.value = data.total
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
watch(
  () => props.kind,
  () => {
    page.value = 1
    search.value = ''
    category.value = ''
    void load()
  },
  { immediate: true },
)
function searchRows() {
  page.value = 1
  void load()
}
function turn(n: number) {
  page.value += n
  void load()
}
</script>
<template>
  <PageIntro
    :title="kind === 'events' ? '活动中心' : '新闻公告'"
    :english="kind === 'events' ? 'CLUB ACTIVITIES' : 'NEWS & NOTICES'"
    description="把想法带到实践中，与电子俱乐部一起成长。"
  />
  <section class="section container">
    <form class="publication-tools" @submit.prevent="searchRows">
      <input
        v-model="search"
        placeholder="搜索标题"
        aria-label="搜索标题"
      /><input
        v-if="kind === 'articles'"
        v-model="category"
        placeholder="分类（留空为全部）"
        aria-label="分类"
      /><button class="button button-outline">查询</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else-if="loading">正在加载…</p>
    <p v-else-if="!rows.length" class="admin-empty">暂无已发布内容。</p>
    <article v-for="row in rows" :key="row.id" class="publication-row">
      <img v-if="row.cover" :src="imageSource(row.cover)" alt="封面" loading="lazy" />
      <div>
        <p class="eyebrow">
          {{ 'pinned' in row && row.pinned ? '置顶 · ' : ''
          }}{{ 'category' in row ? row.category : '社团活动' }} ·
          {{ beijing(row.publishedAt) }}
        </p>
        <h2>
          <RouterLink
            :to="`${kind === 'events' ? '/activities' : '/news'}/${row.id}`"
            >{{ row.title }}</RouterLink
          >
        </h2>
        <p>{{ row.summary }}</p>
        <p v-if="'startsAt' in row">
          {{ beijing(row.startsAt) }} · {{ row.location }}
        </p>
      </div>
    </article>
    <div class="publication-tools">
      <button
        class="button button-outline"
        :disabled="page === 1"
        @click="turn(-1)"
      >
        上一页</button
      ><span>第{{ page }}页 · 共{{ total }}条</span
      ><button
        class="button button-outline"
        :disabled="page * 20 >= total"
        @click="turn(1)"
      >
        下一页
      </button>
    </div>
  </section>
</template>
