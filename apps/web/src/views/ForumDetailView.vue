<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type {
  ForumPostView,
  ForumCommentView,
  Page,
} from '@electronic-club/shared'
import { request } from '../member-api'
import { beijing } from '../stage3'
import { forumImageUrl, forumStatus } from '../forum'
import { useAuthStore } from '../stores/auth'
import SafeMarkdown from '../components/SafeMarkdown.vue'
const route = useRoute(),
  router = useRouter(),
  auth = useAuthStore(),
  post = ref<ForumPostView | null>(null),
  comments = ref<ForumCommentView[]>([]),
  page = ref(1),
  total = ref(0),
  body = ref(''),
  reply = ref<ForumCommentView | null>(null),
  error = ref(''),
  message = ref(''),
  busy = ref(false),
  loading = ref(false),
  liked = ref(false),
  favorited = ref(false),
  reportDialog = ref<HTMLDialogElement | null>(null),
  reportTarget = ref<{ type: 'post' | 'comment'; id: string } | null>(null),
  reportReason = ref('')
const own = computed(
    () => !!post.value && post.value.authorUid === auth.member?.uid,
  ),
  writable = computed(
    () =>
      post.value?.status === 'published' &&
      !post.value.locked &&
      !post.value.commentsClosed &&
      post.value.board.status === 'active',
  )
async function loadComments(anchor = '') {
  const currentPost = String(route.params.id)
  const data = await request<Page<ForumCommentView>>(
    `/forum/posts/${route.params.id}/comments?page=${page.value}${anchor ? '&anchor=' + encodeURIComponent(anchor) : ''}`,
  )
  if (currentPost !== String(route.params.id)) return
  comments.value = data.items
  total.value = data.total
  page.value = data.page
}
let generation = 0
async function load() {
  const current = ++generation
  loading.value = true
  error.value = ''
  post.value = null
  try {
    const loaded = await request<ForumPostView>(
      '/forum/posts/' + route.params.id,
    )
    if (current !== generation) return
    post.value = loaded
    page.value = 1
    await loadComments(String(route.query.comment ?? ''))
    if (current !== generation) return
    if (route.query.comment) {
      await nextTick()
      document
        .getElementById('comment-' + String(route.query.comment))
        ?.scrollIntoView({ block: 'center' })
    }
    try {
      await auth.restore(true)
      if (auth.member) {
        const state = await request<{ liked: boolean; favorited: boolean }>(
          `/forum/posts/${route.params.id}/state`,
        )
        if (current !== generation) return
        liked.value = state.liked
        favorited.value = state.favorited
        if (loaded.status === 'published') {
          const view = await request<{ viewCount: number }>(
            `/forum/posts/${route.params.id}/view`,
            'POST',
            {},
          )
          if (current === generation && post.value)
            post.value.viewCount = view.viewCount
        }
      }
    } catch {
      /* Public discussion remains readable when a session expired. */
    }
  } catch (e) {
    if (current === generation) error.value = (e as Error).message
  } finally {
    if (current === generation) loading.value = false
  }
}
async function reaction(kind: 'like' | 'favorite') {
  await action(async () => {
    const value = kind === 'like' ? !liked.value : !favorited.value
    const data = await request<{ likeCount: number }>(
      `/forum/posts/${route.params.id}/${kind}`,
      'POST',
      { active: value },
    )
    if (kind === 'like') {
      liked.value = value
      if (post.value) post.value.likeCount = data.likeCount
    } else favorited.value = value
  })
}
async function action(fn: () => Promise<void>) {
  if (busy.value || loading.value) return
  busy.value = true
  message.value = ''
  try {
    await fn()
  } catch (e) {
    message.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
async function comment() {
  await action(async () => {
    await request(`/forum/posts/${route.params.id}/comments`, 'POST', {
      body: body.value,
      parentId: reply.value?.id ?? null,
    })
    body.value = ''
    reply.value = null
    message.value = '评论已发布'
    const refreshed = await request<ForumPostView>(
      '/forum/posts/' + route.params.id,
    )
    if (post.value) post.value.commentCount = refreshed.commentCount
    await loadComments()
  })
}
async function replyTo(item: ForumCommentView) {
  reply.value = item
  await nextTick()
  document.getElementById('forum-comment-body')?.focus()
}
function report(type: 'post' | 'comment', id: string) {
  reportTarget.value = { type, id }
  reportReason.value = ''
  reportDialog.value?.showModal()
}
async function sendReport() {
  await action(async () => {
    await request('/forum/reports', 'POST', {
      targetType: reportTarget.value!.type,
      targetId: reportTarget.value!.id,
      reason: reportReason.value,
    })
    message.value = '举报已提交，处理结果会通过站内通知告知'
    reportDialog.value?.close()
  })
}
async function removePost() {
  if (!confirm('确认删除本人帖子？')) return
  await action(async () => {
    await request(`/forum/posts/${route.params.id}/delete`, 'POST', {})
    await router.push('/community')
  })
}
async function removeComment(item: ForumCommentView) {
  if (!confirm('确认删除本人评论？')) return
  await action(async () => {
    await request(`/forum/comments/${item.id}/delete`, 'POST', {})
    await loadComments()
  })
}
async function turn(delta: number) {
  page.value += delta
  try {
    await loadComments()
  } catch (e) {
    message.value = (e as Error).message
  }
}
watch(
  () => route.params.id,
  () => {
    comments.value = []
    liked.value = false
    favorited.value = false
    void load()
  },
  { immediate: true },
)
</script>
<template>
  <section class="container section forum-thread">
    <RouterLink to="/community">← 返回电子社区</RouterLink>
    <p v-if="error" role="alert">{{ error }}</p>
    <article v-if="post">
      <header class="forum-thread-header">
        <p class="eyebrow">
          {{ post.board.name }} · {{ forumStatus[post.status] }}
        </p>
        <h1>{{ post.title }}</h1>
        <div class="forum-author">
          <img
            v-if="post.author.avatar"
            :src="post.author.avatar"
            alt="作者头像"
          /><span
            >{{ post.author.nickname }} · {{ beijing(post.createdAt) }}</span
          >
        </div>
        <div class="forum-post-flags">
          <span v-if="post.pinned">置顶</span
          ><span v-if="post.featured">精华</span
          ><span v-if="post.locked">已锁定</span
          ><span v-if="post.commentsClosed">评论已关闭</span>
        </div>
        <p v-if="post.moderationReason" class="forum-notice">
          处理说明：{{ post.moderationReason }}
        </p>
      </header>
      <SafeMarkdown :content="post.body" />
      <div class="forum-thread-images">
        <img
          v-for="(image, index) in post.imageIds"
          :key="image"
          :src="forumImageUrl(image)"
          :alt="'帖子附图 ' + (index + 1)"
          loading="lazy"
        />
      </div>
      <div class="forum-thread-actions">
        <span
          >{{ post.viewCount }} 次成员浏览 ·
          {{ post.commentCount }} 条评论</span
        ><template v-if="auth.member"
          ><button
            :disabled="busy || loading || post.status !== 'published'"
            @click="reaction('like')"
          >
            {{ liked ? '取消点赞' : '点赞' }} · {{ post.likeCount }}</button
          ><button
            :disabled="busy || loading || post.status !== 'published'"
            @click="reaction('favorite')"
          >
            {{ favorited ? '取消收藏' : '收藏' }}</button
          ><button @click="report('post', post.id)">举报</button
          ><RouterLink
            v-if="own && !post.locked"
            :to="'/community/' + post.id + '/edit'"
            >编辑</RouterLink
          ><button v-if="own" :disabled="busy || loading" @click="removePost">
            删除本人帖子
          </button></template
        ><RouterLink v-else to="/login">登录参与讨论</RouterLink>
      </div>
      <section class="forum-comments">
        <h2>讨论与回复</h2>
        <article
          v-for="item in comments"
          :id="'comment-' + item.id"
          :key="item.id"
          class="forum-comment"
          :class="{ 'forum-comment-reply': !!item.parentId }"
        >
          <header>
            <div class="forum-author">
              <img
                v-if="item.author.avatar"
                :src="item.author.avatar"
                alt="评论者头像"
              /><strong>{{ item.author.nickname || '成员' }}</strong>
            </div>
            <small>#{{ item.floor }} · {{ beijing(item.createdAt) }}</small>
          </header>
          <p v-if="item.parentId" class="forum-reply-reference">
            回复 #{{ item.parent?.floor ?? '—' }}
            {{ item.parent?.nickname ?? '成员' }}
          </p>
          <SafeMarkdown :content="item.body" />
          <div
            v-if="auth.member && item.status === 'published'"
            class="forum-comment-actions"
          >
            <button v-if="writable" @click="replyTo(item)">回复</button
            ><button @click="report('comment', item.id)">举报</button
            ><button
              v-if="item.authorUid === auth.member.uid"
              :disabled="busy || loading"
              @click="removeComment(item)"
            >
              删除
            </button>
          </div>
        </article>
        <p v-if="!comments.length">还没有公开评论。</p>
        <div class="forum-pagination">
          <button :disabled="page <= 1" @click="turn(-1)">上一页</button
          ><span>第{{ page }}页 · 共{{ total }}条</span
          ><button :disabled="page * 20 >= total" @click="turn(1)">
            下一页
          </button>
        </div>
        <form
          v-if="auth.member && writable"
          class="member-form"
          @submit.prevent="comment"
        >
          <p v-if="reply">
            回复 #{{ reply.floor }} {{ reply.author.nickname }}
            <button type="button" @click="reply = null">取消回复</button>
          </p>
          <label for="forum-comment-body">你的回复</label
          ><textarea
            id="forum-comment-body"
            v-model="body"
            maxlength="1500"
            rows="5"
            required
            :disabled="busy || loading"
          /><button class="button button-primary" :disabled="busy || loading">
            发布评论
          </button>
        </form>
        <p v-else-if="!auth.member">
          <RouterLink :to="'/login?next=' + encodeURIComponent(route.fullPath)"
            >登录后发表评论</RouterLink
          >
        </p>
        <p v-else class="forum-notice">
          帖子尚未公开、已锁定，或当前不接受评论。
        </p>
      </section>
    </article>
    <p role="status" aria-live="polite">{{ message }}</p>
    <dialog ref="reportDialog" class="forum-report-dialog">
      <form class="member-form" @submit.prevent="sendReport">
        <h2>举报内容</h2>
        <p>请说明违规原因，管理员会核实处理。</p>
        <label
          >举报原因<textarea
            v-model="reportReason"
            minlength="2"
            maxlength="500"
            rows="5"
            required
          />
        </label>
        <div class="publication-tools">
          <button class="button button-primary" :disabled="busy || loading">
            提交举报</button
          ><button type="button" @click="reportDialog?.close()">取消</button>
        </div>
        <p role="status">{{ message }}</p>
      </form>
    </dialog>
  </section>
</template>
