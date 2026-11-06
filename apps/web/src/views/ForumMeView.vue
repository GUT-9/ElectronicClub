<script setup lang="ts">
import { ref, watch, computed } from 'vue'
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
import ContentState from '../components/ContentState.vue'
import ForumPostRows from '../components/ForumPostRows.vue'
const tab = ref('posts'),
  posts = ref<ForumPostView[]>([]),
  comments = ref<ForumComment[]>([]),
  notifications = ref<ForumNotification[]>([]),
  reports = ref<ForumReport[]>([]),
  page = ref(1),
  total = ref(0),
  message = ref(''),
  busy = ref(false),
  loadError = ref('')
const empty = computed(
  () =>
    ({
      posts: ['还没有发布帖子', '把制作中的发现或问题写下来，开启一次交流。'],
      comments: ['还没有参与评论', '到社区看看有没有你感兴趣的话题。'],
      favorites: [
        '还没有收藏帖子',
        '在帖子详情点击收藏，把有用的讨论留在这里。',
      ],
      notifications: [
        '暂时没有新回复',
        '有人回复你的帖子或评论时，会在这里收到通知。',
      ],
      reports: ['还没有举报记录', '你提交的内容举报和处理结果会在这里展示。'],
    })[tab.value] ?? ['暂无记录', ''],
)
let generation = 0
async function load(reset = false) {
  const current = ++generation
  if (reset) page.value = 1
  busy.value = true
  message.value = ''
  loadError.value = ''
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
    if (current === generation) loadError.value = (e as Error).message
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
    <p class="page-subtitle">你的讨论、收藏和收到的回应，都在这里。</p>
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
    <ContentState v-if="busy" loading /><ContentState
      v-else-if="loadError"
      error
      title="记录暂时无法加载"
      description="请稍后重试。"
      @retry="load()"
    />
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
      <ContentState v-if="!total" :title="empty[0]" :description="empty[1]"
        ><RouterLink class="text-link" to="/community"
          >去社区看看 →</RouterLink
        ></ContentState
      ></template
    >
    <div v-if="total > 20 && !loadError" class="forum-pagination">
      <button :disabled="busy || page <= 1" @click="turn(-1)">上一页</button
      ><span>第{{ page }}页 · 共{{ total }}条</span
      ><button :disabled="busy || page * 20 >= total" @click="turn(1)">
        下一页
      </button>
    </div>
    <p role="status">{{ message }}</p>
  </section>
</template>
