<script setup lang="ts">
import { ref, watch } from 'vue'
import type {
  ForumPostView,
  ForumComment,
  ForumNotification,
  ForumReport,
  Page,
} from '@electronic-club/shared'
import { request } from '../member-api'
import { beijing } from '../stage3'
import { forumStatus } from '../forum'
import ForumPostRows from '../components/ForumPostRows.vue'
const tab = ref('posts'),
  posts = ref<ForumPostView[]>([]),
  comments = ref<ForumComment[]>([]),
  notifications = ref<ForumNotification[]>([]),
  reports = ref<ForumReport[]>([]),
  page = ref(1),
  total = ref(0),
  message = ref(''),
  busy = ref(false)
let generation = 0
async function load(reset = false) {
  const current = ++generation
  if (reset) page.value = 1
  busy.value = true
  message.value = ''
  try {
    const data = await request<
      Page<ForumPostView | ForumComment | ForumNotification | ForumReport>
    >(`/forum/me/${tab.value}?page=${page.value}`)
    if (current !== generation) return
    total.value = data.total
    posts.value = data.items as ForumPostView[]
    comments.value = data.items as ForumComment[]
    notifications.value = data.items as ForumNotification[]
    reports.value = data.items as ForumReport[]
  } catch (e) {
    if (current === generation) message.value = (e as Error).message
  } finally {
    if (current === generation) busy.value = false
  }
}
async function read(item: ForumNotification) {
  try {
    await request('/forum/me/notifications/' + item.id, 'POST', {})
    item.read = true
  } catch (e) {
    message.value = (e as Error).message
  }
}
async function turn(delta: number) {
  page.value += delta
  await load()
}
watch(tab, () => void load(true), { immediate: true })
</script>
<template>
  <section class="container section forum-me">
    <RouterLink to="/community">← 返回电子社区</RouterLink>
    <p class="eyebrow">MY COMMUNITY</p>
    <h1>我的社区</h1>
    <nav class="forum-sort">
      <button
        v-for="item in [
          ['posts', '我的帖子'],
          ['comments', '我的评论'],
          ['favorites', '我的收藏'],
          ['notifications', '回复通知'],
          ['reports', '我的举报'],
        ]"
        :key="item[0]"
        :class="{ selected: tab === item[0] }"
        @click="tab = item[0]!"
      >
        {{ item[1] }}
      </button>
    </nav>
    <p v-if="busy">正在加载…</p>
    <template v-else
      ><ForumPostRows
        v-if="tab === 'posts' || tab === 'favorites'"
        :items="posts"
      />
      <article
        v-for="item in tab === 'comments' ? comments : []"
        :key="item.id"
        class="forum-inbox-row"
      >
        <p>{{ item.body }}</p>
        <small
          >{{ beijing(item.createdAt) }} · {{ forumStatus[item.status] }}</small
        ><RouterLink :to="'/community/' + item.postId + '?comment=' + item.id"
          >查看讨论 ↗</RouterLink
        >
      </article>
      <article
        v-for="item in tab === 'notifications' ? notifications : []"
        :key="item.id"
        class="forum-inbox-row"
      >
        <strong>{{ item.read ? '' : '未读 · ' }}{{ item.message }}</strong
        ><small>{{ beijing(item.createdAt) }}</small>
        <div>
          <RouterLink
            :to="
              '/community/' +
              item.postId +
              (item.commentId ? '?comment=' + item.commentId : '')
            "
            @click="read(item)"
            >查看讨论 ↗</RouterLink
          ><button v-if="!item.read" @click="read(item)">标记已读</button>
        </div>
      </article>
      <article
        v-for="item in tab === 'reports' ? reports : []"
        :key="item.id"
        class="forum-inbox-row"
      >
        <p>{{ item.reason }}</p>
        <span>{{ forumStatus[item.status] }}</span>
        <p v-if="item.resolution">处理结果：{{ item.resolution }}</p>
        <small>{{ beijing(item.createdAt) }}</small>
      </article>
      <p v-if="!total" class="admin-empty">这里还没有记录。</p></template
    >
    <div class="forum-pagination">
      <button :disabled="busy || page <= 1" @click="turn(-1)">上一页</button
      ><span>第{{ page }}页 · 共{{ total }}条</span
      ><button :disabled="busy || page * 20 >= total" @click="turn(1)">
        下一页
      </button>
    </div>
    <p role="status">{{ message }}</p>
  </section>
</template>
