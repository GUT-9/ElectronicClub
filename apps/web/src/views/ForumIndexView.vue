<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import type { ForumBoard, ForumPostView, Page } from '@electronic-club/shared'
import { request } from '../member-api'
import { useAuthStore } from '../stores/auth'
import ForumPostRows from '../components/ForumPostRows.vue'
import PageIntro from '../components/PageIntro.vue'
const auth = useAuthStore(),
  boards = ref<ForumBoard[]>([]),
  posts = ref<ForumPostView[]>([]),
  boardId = ref(''),
  sort = ref('latest'),
  search = ref(''),
  page = ref(1),
  total = ref(0),
  busy = ref(false),
  error = ref('')
const boardPage = ref(1),
  boardTotal = ref(0),
  boardBusy = ref(false)
async function moreBoards() {
  if (boardBusy.value) return
  boardBusy.value = true
  try {
    const result = await request<Page<ForumBoard>>(
      '/forum/boards?pageSize=30&page=' + boardPage.value,
    )
    boards.value.push(...result.items)
    boardTotal.value = result.total
    boardPage.value++
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    boardBusy.value = false
  }
}
const createTarget = computed(
  () =>
    '/community/new' +
    (boardId.value ? '?board=' + encodeURIComponent(boardId.value) : ''),
)
let generation = 0
async function load(reset = false) {
  const current = ++generation
  if (reset) page.value = 1
  busy.value = true
  error.value = ''
  try {
    const q = new URLSearchParams({
      page: String(page.value),
      sort: sort.value,
      search: search.value,
      boardId: boardId.value,
    })
    const data = await request<Page<ForumPostView>>('/forum/posts?' + q)
    if (current !== generation) return
    posts.value = data.items
    total.value = data.total
  } catch (e) {
    if (current === generation) error.value = (e as Error).message
  } finally {
    if (current === generation) busy.value = false
  }
}
function selectBoard(id: string) {
  boardId.value = id
  void load(true)
}
function selectSort(value: string) {
  sort.value = value
  void load(true)
}
async function turn(delta: number) {
  page.value += delta
  await load()
}
onMounted(async () => {
  try {
    await moreBoards()
    await load()
  } catch (e) {
    error.value = (e as Error).message
  }
})
</script>
<template>
  <PageIntro
    title="电子社区"
    english="BUILD · SHARE · CONNECT"
    description="从一个电路问题，到一件共同完成的作品。在这里记录、讨论与分享。"
  />
  <section class="container section forum-workspace">
    <aside class="forum-sidebar">
      <h2>交流版块</h2>
      <button :class="{ selected: !boardId }" @click="selectBoard('')">
        全部讨论</button
      ><button
        v-for="board in boards"
        :key="board.id"
        :class="{ selected: boardId === board.id }"
        @click="selectBoard(board.id)"
      >
        {{ board.name
        }}<small v-if="board.status === 'disabled'">只读</small></button
      ><button
        v-if="boards.length < boardTotal"
        :disabled="boardBusy"
        @click="moreBoards"
      >
        更多版块</button
      ><RouterLink to="/community/me" class="text-link"
        >我的社区与通知 ↗</RouterLink
      >
      <p>专注电子技术，尊重每一次提问。请勿发布学号、手机号等个人敏感信息。</p>
    </aside>
    <main class="forum-feed">
      <div class="forum-feed-toolbar">
        <form @submit.prevent="load(true)">
          <input
            v-model="search"
            maxlength="80"
            placeholder="搜索帖子标题或正文"
            aria-label="搜索帖子"
          /><button class="button button-outline" :disabled="busy">搜索</button>
        </form>
        <RouterLink
          class="button button-primary"
          :to="
            auth.member
              ? createTarget
              : '/login?next=' + encodeURIComponent(createTarget)
          "
          >发布帖子</RouterLink
        >
      </div>
      <nav class="forum-sort" aria-label="帖子排序">
        <button
          v-for="item in [
            ['latest', '最新发布'],
            ['reply', '最新回复'],
            ['hot', '热门讨论'],
            ['featured', '精华帖子'],
          ]"
          :key="item[0]"
          :class="{ selected: sort === item[0] }"
          @click="selectSort(item[0]!)"
        >
          {{ item[1] }}
        </button>
      </nav>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="busy">正在加载讨论…</p>
      <ForumPostRows v-else :items="posts" />
      <div v-if="!busy && !posts.length && !error" class="admin-empty">
        这个版块还没有公开帖子，分享你的第一个想法吧。
      </div>
      <div class="forum-pagination">
        <button :disabled="busy || page <= 1" @click="turn(-1)">上一页</button
        ><span>第{{ page }}页 · 共{{ total }}帖</span
        ><button :disabled="busy || page * 20 >= total" @click="turn(1)">
          下一页
        </button>
      </div>
    </main>
  </section>
</template>
