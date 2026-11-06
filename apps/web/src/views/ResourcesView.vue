<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { ClubResource, Page } from '@electronic-club/shared'
import { request } from '../member-api'
import PageIntro from '../components/PageIntro.vue'
import ContentState from '../components/ContentState.vue'
import { shortDate } from '../presentation'
const rows = ref<ClubResource[]>([]),
  page = ref(1),
  total = ref(0),
  search = ref(''),
  category = ref(''),
  busy = ref(true),
  error = ref(''),
  message = ref(''),
  downloading = ref('')
const bytes = (n: number) =>
  n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB'
let generation = 0
async function load() {
  const seq = ++generation
  busy.value = true
  error.value = ''
  try {
    const data = await request<Page<ClubResource>>(
      '/resources?' +
        new URLSearchParams({
          page: String(page.value),
          search: search.value,
          category: category.value,
        }),
    )
    if (seq === generation) {
      rows.value = data.items
      total.value = data.total
    }
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message
  } finally {
    if (seq === generation) busy.value = false
  }
}
function filter() {
  page.value = 1
  void load()
}
function turn(n: number) {
  page.value += n
  void load()
}
async function download(row: ClubResource) {
  if (downloading.value) return
  downloading.value = row.id
  message.value = ''
  try {
    const result = await request<{ url: string }>(
      `/resources/${row.id}/download`,
    )
    const u = new URL(result.url)
    if (u.protocol !== 'https:') throw new Error('下载地址无效')
    const link = document.createElement('a')
    link.href = u.href
    link.rel = 'noopener noreferrer'
    link.click()
  } catch (e) {
    message.value = (e as Error).message
  } finally {
    downloading.value = ''
  }
}
onMounted(load)
</script>
<template>
  <PageIntro
    title="社团资料库"
    english="LEARN · BUILD · SHARE"
    description="教程、竞赛资料、项目文档与社团资料。在这里找到下一次实践需要的参考。"
  />
  <section class="container resource-library">
    <form class="public-search" @submit.prevent="filter">
      <label class="public-search-field"
        ><span class="search-symbol" aria-hidden="true">⌕</span
        ><input
          v-model="search"
          placeholder="搜索资料标题、说明或文件名"
          aria-label="搜索资料"
          maxlength="80" /></label
      ><input
        v-model="category"
        class="category-input"
        placeholder="分类（选填）"
        aria-label="资料分类"
        maxlength="40"
        list="resource-categories"
      /><datalist id="resource-categories">
        <option>基础教程</option>
        <option>竞赛资料</option>
        <option>项目文档</option>
        <option>社团制度</option>
        <option>其他</option></datalist
      ><button class="button button-primary" :disabled="busy">搜索</button>
    </form>
    <p v-if="message" class="ui-message" role="alert">{{ message }}</p>
    <ContentState v-if="busy" loading /><ContentState
      v-else-if="error"
      error
      title="资料暂时无法加载"
      description="请稍后重试。"
      @retry="load"
    /><ContentState
      v-else-if="!rows.length"
      title="暂无符合条件的资料"
      description="可以换个关键词试试，公开资料发布后将在这里展示。"
    /><template v-else
      ><p class="resource-count">共 {{ total }} 份公开资料</p>
      <article v-for="row in rows" :key="row.id" class="resource-card">
        <span class="resource-file-icon" aria-hidden="true">{{
          row.originalName.split('.').pop()?.toUpperCase()
        }}</span>
        <div class="resource-card-main">
          <div class="resource-card-meta">
            <span class="ui-tag">{{ row.category }}</span
            ><time>{{ shortDate(row.publishedAt ?? row.createdAt) }}</time
            ><span>{{ bytes(row.size) }}</span>
          </div>
          <h2>{{ row.title }}</h2>
          <p v-if="row.description">{{ row.description }}</p>
          <small>{{ row.originalName }}</small>
        </div>
        <button
          class="button button-outline"
          :disabled="!!downloading"
          @click="download(row)"
        >
          {{ downloading === row.id ? '准备下载…' : '下载资料 ↓' }}
        </button>
      </article></template
    >
    <nav
      v-if="total > 20 && !error"
      class="public-pagination"
      aria-label="资料分页"
    >
      <button
        class="button button-outline"
        :disabled="busy || page <= 1"
        @click="turn(-1)"
      >
        上一页</button
      ><span>{{ page }} / {{ Math.ceil(total / 20) }}</span
      ><button
        class="button button-outline"
        :disabled="busy || page * 20 >= total"
        @click="turn(1)"
      >
        下一页
      </button>
    </nav>
  </section>
</template>
<style scoped>
.resource-library {
  padding-block: 36px 70px;
  min-height: 50vh;
}
.resource-count {
  font-size: 12px;
  margin-bottom: 18px;
}
.resource-card {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 26px;
  border: 1px solid var(--line);
  border-radius: 10px;
  margin: 16px 0;
  background: #fff;
}
.resource-file-icon {
  display: grid;
  place-items: center;
  width: 60px;
  height: 72px;
  flex-shrink: 0;
  border: 1px solid #cbdcf2;
  border-radius: 8px;
  background: #f0f5fd;
  color: var(--blue);
  font: 12px var(--mono);
}
.resource-card-main {
  flex: 1;
  min-width: 0;
}
.resource-card-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--muted);
}
.resource-card h2 {
  font-size: 21px;
  margin: 12px 0 8px;
  overflow-wrap: anywhere;
}
.resource-card p {
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.resource-card small {
  display: block;
  color: var(--muted);
  font-size: 11px;
  margin-top: 10px;
  overflow-wrap: anywhere;
}
.resource-card > .button {
  white-space: nowrap;
}
@media (max-width: 600px) {
  .resource-card {
    gap: 16px;
    padding: 20px;
    flex-wrap: wrap;
  }
  .resource-file-icon {
    width: 44px;
    height: 56px;
    font-size: 10px;
  }
  .resource-card-main {
    flex-basis: calc(100% - 65px);
  }
  .resource-card h2 {
    font-size: 18px;
  }
  .resource-card > .button {
    margin-left: 60px;
  }
}
</style>
