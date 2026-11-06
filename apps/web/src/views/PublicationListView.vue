<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { ClubEvent, ClubArticle, Page } from '@electronic-club/shared'
import { request } from '../member-api'
import PageIntro from '../components/PageIntro.vue'
import PublicationCard from '../components/PublicationCard.vue'
import ContentState from '../components/ContentState.vue'
const props = defineProps<{ kind: 'events' | 'articles' }>()
const rows = ref<(ClubEvent | ClubArticle)[]>([]),
  error = ref(''),
  search = ref(''),
  category = ref(''),
  page = ref(1),
  total = ref(0),
  loading = ref(true),
  filtered = ref(false)
const label = computed(() => (props.kind === 'events' ? '活动' : '公告'))
let generation = 0
async function load() {
  const seq = ++generation
  loading.value = true
  error.value = ''
  try {
    const data = await request<Page<ClubEvent | ClubArticle>>(
      `/public/${props.kind}?page=${page.value}&search=${encodeURIComponent(search.value)}&category=${encodeURIComponent(category.value)}`,
    )
    if (seq !== generation) return
    rows.value = data.items
    total.value = data.total
    filtered.value = !!(search.value.trim() || category.value.trim())
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message
  } finally {
    if (seq === generation) loading.value = false
  }
}
watch(
  () => props.kind,
  () => {
    page.value = 1
    search.value = ''
    category.value = ''
    rows.value = []
    void load()
  },
  { immediate: true },
)
function searchRows() {
  page.value = 1
  void load()
}
function reset() {
  search.value = ''
  category.value = ''
  searchRows()
}
function turn(n: number) {
  page.value += n
  void load()
}
</script>
<template>
  <PageIntro
    :title="kind === 'events' ? '活动中心' : '新闻公告'"
    :english="kind === 'events' ? 'LEARN BY DOING' : 'CLUB JOURNAL'"
    :description="
      kind === 'events'
        ? '一起焊接、调试、设计与制作。找到感兴趣的活动，把想法做成作品。'
        : '社团动态、活动回顾与重要通知，让每一次探索都有迹可循。'
    "
  />
  <section class="container publication-list-page">
    <div class="publication-list-heading">
      <div>
        <p class="eyebrow">
          {{ kind === 'events' ? 'EXPLORE ACTIVITIES' : 'LATEST UPDATES' }}
        </p>
        <h2>
          {{
            kind === 'events' ? '找到下一次实践的机会' : '了解社团的最新动态'
          }}
        </h2>
      </div>
      <span v-if="!loading && !error" class="result-count"
        >{{ total }} 条{{ label }}</span
      >
    </div>
    <form class="public-search" @submit.prevent="searchRows">
      <label class="public-search-field"
        ><span class="search-symbol" aria-hidden="true">⌕</span
        ><input
          v-model="search"
          :placeholder="`搜索${label}标题`"
          :aria-label="`搜索${label}标题`"
          maxlength="120" /></label
      ><input
        v-if="kind === 'articles'"
        v-model="category"
        class="category-input"
        placeholder="公告分类（选填）"
        aria-label="公告分类"
        maxlength="40"
      /><button class="button button-primary" :disabled="loading">搜索</button
      ><button
        v-if="filtered"
        type="button"
        class="plain-button"
        :disabled="loading"
        @click="reset"
      >
        清除筛选
      </button>
    </form>
    <ContentState v-if="loading" loading /><ContentState
      v-else-if="error"
      error
      title="内容暂时无法加载"
      description="请检查网络后重试，你也可以稍后再来看看。"
      @retry="load"
    /><ContentState
      v-else-if="!rows.length"
      :title="filtered ? '没有找到匹配的内容' : `暂时没有公开${label}`"
      :description="
        filtered
          ? '试试其他关键词，或清除筛选查看全部内容。'
          : kind === 'events'
            ? '新的活动安排会在这里发布。欢迎先到社区交流你的想法。'
            : '新的通知和社团动态会在这里及时发布。'
      "
      ><button v-if="filtered" class="plain-button" @click="reset">
        查看全部{{ label }} →</button
      ><RouterLink v-else to="/community" class="text-link"
        >前往电子社区 →</RouterLink
      ></ContentState
    >
    <div v-else class="publication-card-grid">
      <PublicationCard v-for="row in rows" :key="row.id" :item="row" />
    </div>
    <nav
      v-if="total > 20 && !error"
      class="public-pagination"
      aria-label="内容分页"
    >
      <button
        class="button button-outline"
        :disabled="loading || page <= 1"
        @click="turn(-1)"
      >
        上一页</button
      ><span>{{ page }} / {{ Math.ceil(total / 20) }}</span
      ><button
        class="button button-outline"
        :disabled="loading || page * 20 >= total"
        @click="turn(1)"
      >
        下一页
      </button>
    </nav>
  </section>
</template>
