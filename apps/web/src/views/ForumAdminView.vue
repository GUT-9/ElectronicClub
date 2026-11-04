<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import type {
  ForumBoard,
  ForumPostView,
  ForumComment,
  ForumReport,
  ForumRestriction,
  Page,
  ForumAuditLog,
} from '@electronic-club/shared'
import { useAuthStore } from '../stores/auth'
import { request } from '../member-api'
import { FORUM_PERMISSIONS, forumStatus } from '../forum'
import { beijing, utcTime } from '../stage3'
const auth = useAuthStore(),
  tab = ref('posts'),
  page = ref(1),
  total = ref(0),
  busy = ref(false),
  message = ref(''),
  reason = ref(''),
  status = ref(''),
  search = ref(''),
  boards = ref<ForumBoard[]>([]),
  posts = ref<ForumPostView[]>([]),
  comments = ref<ForumComment[]>([]),
  reports = ref<ForumReport[]>([]),
  restrictions = ref<ForumRestriction[]>([]),
  audit = ref<ForumAuditLog[]>([]),
  selected = ref(''),
  board = reactive({
    name: '',
    description: '',
    position: 1,
    status: 'active',
    requireReview: false,
  }),
  restriction = reactive({
    studentId: '',
    posts: true,
    comments: true,
    postsUntil: '',
    commentsUntil: '',
    reason: '',
  })
const tabs = computed(() =>
  [
    {
      id: 'boards',
      label: '版块管理',
      allowed: auth.can('forum.boards.manage'),
    },
    {
      id: 'posts',
      label: '帖子管理',
      allowed: FORUM_PERMISSIONS.filter((p) =>
        p.startsWith('forum.posts.'),
      ).some(auth.can),
    },
    {
      id: 'comments',
      label: '评论管理',
      allowed: auth.can('forum.comments.moderate'),
    },
    {
      id: 'reports',
      label: '举报处理',
      allowed: auth.can('forum.reports.manage'),
    },
    {
      id: 'restrictions',
      label: '发帖限制',
      allowed: auth.can('forum.users.restrict'),
    },
    {
      id: 'audit',
      label: '审核记录',
      allowed: FORUM_PERMISSIONS.some(auth.can),
    },
  ].filter((t) => t.allowed),
)
async function run(fn: () => Promise<void>) {
  if (busy.value) return false
  busy.value = true
  message.value = ''
  try {
    await fn()
    return true
  } catch (e) {
    message.value = (e as Error).message
    return false
  } finally {
    busy.value = false
  }
}
async function load() {
  await run(async () => {
    const path =
      tab.value === 'boards'
        ? '/forum/boards?admin=true'
        : tab.value === 'restrictions'
          ? '/forum/restrictions?'
          : '/forum/admin/' + tab.value + '?'
    const data = await request<
      Page<
        | ForumBoard
        | ForumPostView
        | ForumComment
        | ForumReport
        | ForumRestriction
        | ForumAuditLog
      >
    >(
      path +
        (path.endsWith('?') ? '' : '&') +
        new URLSearchParams({
          page: String(page.value),
          status: status.value,
          search: search.value,
        }),
    )
    total.value = data.total
    boards.value = data.items as ForumBoard[]
    posts.value = data.items as ForumPostView[]
    comments.value = data.items as ForumComment[]
    reports.value = data.items as ForumReport[]
    restrictions.value = data.items as ForumRestriction[]
    audit.value = data.items as ForumAuditLog[]
  })
}
async function choose(id: string) {
  tab.value = id
  page.value = 1
  status.value = ''
  search.value = ''
  await load()
}
function editBoard(item?: ForumBoard) {
  selected.value = item?.id ?? ''
  Object.assign(
    board,
    item ?? {
      name: '',
      description: '',
      position: 1,
      status: 'active',
      requireReview: false,
    },
  )
}
async function saveBoard() {
  const ok = await run(async () => {
    await request(
      '/forum/boards' + (selected.value ? '/' + selected.value : ''),
      'POST',
      {
        name: board.name,
        description: board.description,
        position: Number(board.position),
        status: board.status,
        requireReview: board.requireReview,
      },
    )
    editBoard()
  })
  if (ok) await load()
}
async function postAction(post: ForumPostView, action: string, value = true) {
  if (!reason.value.trim()) {
    message.value = '请先填写处理原因'
    return
  }
  const ok = await run(async () => {
    await request('/forum/posts/' + post.id + '/moderate', 'POST', {
      action,
      value,
      reason: reason.value,
    })
  })
  if (ok) await load()
}
async function commentAction(item: ForumComment, status: string) {
  if (!reason.value.trim()) {
    message.value = '请先填写处理原因'
    return
  }
  const ok = await run(async () => {
    await request('/forum/comments/' + item.id + '/moderate', 'POST', {
      status,
      reason: reason.value,
    })
  })
  if (ok) await load()
}
async function resolve(item: ForumReport, status: string) {
  if (reason.value.trim().length < 2) {
    message.value = '请填写处理结论（至少2字）'
    return
  }
  const ok = await run(async () => {
    await request('/forum/reports/' + item.id, 'POST', {
      status,
      resolution: reason.value,
    })
  })
  if (ok) await load()
}
async function saveRestriction() {
  const ok = await run(async () => {
    await request('/forum/restrictions', 'POST', {
      ...restriction,
      postsUntil: restriction.postsUntil
        ? utcTime(restriction.postsUntil)
        : null,
      commentsUntil: restriction.commentsUntil
        ? utcTime(restriction.commentsUntil)
        : null,
    })
  })
  if (ok) await load()
}
function searchRows() {
  page.value = 1
  void load()
}
async function turn(delta: number) {
  page.value += delta
  await load()
}
onMounted(() => {
  tab.value = tabs.value[0]?.id ?? 'audit'
  void load()
})
</script>
<template>
  <p class="eyebrow">COMMUNITY WORKSPACE</p>
  <h1>电子社区管理</h1>
  <p>管理能力来自角色授权。每次审核、限制和版块变更都会记录审计。</p>
  <nav class="forum-sort">
    <button
      v-for="item in tabs"
      :key="item.id"
      :class="{ selected: tab === item.id }"
      :disabled="busy"
      @click="choose(item.id)"
    >
      {{ item.label }}
    </button>
  </nav>
  <p role="status">{{ message }}</p>
  <form
    v-if="tab === 'posts' || tab === 'reports'"
    class="publication-tools"
    @submit.prevent="searchRows"
  >
    <input
      v-if="tab === 'posts'"
      v-model="search"
      placeholder="搜索帖子"
      maxlength="80"
    /><select v-model="status">
      <option value="">全部状态</option>
      <template v-if="tab === 'posts'"
        ><option value="pending">待审核</option>
        <option value="published">已发布</option>
        <option value="hidden">已隐藏</option>
        <option value="deleted">已删除</option></template
      ><template v-else
        ><option value="open">待处理</option>
        <option value="resolved">已处理</option>
        <option value="dismissed">不予受理</option></template
      ></select
    ><button :disabled="busy">查询</button>
  </form>
  <label
    v-if="['posts', 'comments', 'reports'].includes(tab)"
    class="forum-moderation-reason"
    >处理原因 / 举报结论<textarea
      v-model="reason"
      maxlength="300"
      rows="3"
      placeholder="操作前填写，相关成员会收到通知"
    />
  </label>
  <p v-if="busy">正在处理…</p>
  <template v-else
    ><template v-if="tab === 'boards'"
      ><div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>版块</th>
              <th>顺序</th>
              <th>状态</th>
              <th>审核</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in boards" :key="item.id">
              <td>{{ item.name }}</td>
              <td>{{ item.position }}</td>
              <td>{{ forumStatus[item.status] }}</td>
              <td>{{ item.requireReview ? '发布需审核' : '直接发布' }}</td>
              <td><button @click="editBoard(item)">编辑</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <form class="member-form" @submit.prevent="saveBoard">
        <h2>{{ selected ? '编辑版块' : '新建版块' }}</h2>
        <label>名称<input v-model="board.name" maxlength="40" required /></label
        ><label
          >简介<textarea v-model="board.description" maxlength="300" /></label
        ><label
          >排序<input
            v-model="board.position"
            type="number"
            min="0"
            max="1000"
            required /></label
        ><label
          >状态<select v-model="board.status">
            <option value="active">正常</option>
            <option value="hidden">隐藏</option>
            <option value="disabled">停用（公开只读）</option>
          </select></label
        ><label class="checkbox-line"
          ><input
            v-model="board.requireReview"
            type="checkbox"
          />发布需审核</label
        >
        <div class="publication-tools">
          <button class="button button-primary">保存版块</button
          ><button type="button" @click="editBoard()">取消编辑 / 新建</button>
        </div>
      </form></template
    >
    <article
      v-for="item in tab === 'posts' ? posts : []"
      :key="item.id"
      class="forum-admin-row"
    >
      <header>
        <RouterLink :to="'/community/' + item.id">{{ item.title }}</RouterLink
        ><span
          >{{ forumStatus[item.status] }} · {{ item.author.nickname }} ·
          {{ item.board.name }}</span
        >
      </header>
      <p>{{ item.body.slice(0, 300) }}</p>
      <div v-if="item.status !== 'deleted'" class="forum-admin-actions">
        <button
          v-if="auth.can('forum.posts.review') && item.status !== 'published'"
          @click="postAction(item, 'approve')"
        >
          审核通过</button
        ><button
          v-if="auth.can('forum.posts.review') && item.status === 'published'"
          @click="postAction(item, 'hide')"
        >
          隐藏</button
        ><button
          v-if="auth.can('forum.posts.pin')"
          @click="postAction(item, 'pin', !item.pinned)"
        >
          {{ item.pinned ? '取消置顶' : '置顶' }}</button
        ><button
          v-if="auth.can('forum.posts.feature')"
          @click="postAction(item, 'feature', !item.featured)"
        >
          {{ item.featured ? '取消加精' : '加精' }}</button
        ><button
          v-if="auth.can('forum.posts.lock')"
          @click="postAction(item, 'lock', !item.locked)"
        >
          {{ item.locked ? '解锁' : '锁帖' }}</button
        ><button
          v-if="auth.can('forum.posts.lock')"
          @click="postAction(item, 'close-comments', !item.commentsClosed)"
        >
          {{ item.commentsClosed ? '开放评论' : '关闭评论' }}</button
        ><button
          v-if="auth.can('forum.posts.delete')"
          @click="postAction(item, 'delete')"
        >
          删除违规内容
        </button>
      </div>
    </article>
    <article
      v-for="item in tab === 'comments' ? comments : []"
      :key="item.id"
      class="forum-admin-row"
    >
      <header>
        <RouterLink :to="'/community/' + item.postId"
          >查看帖子 · #{{ item.floor }}</RouterLink
        ><span
          >{{ forumStatus[item.status] }} · {{ beijing(item.createdAt) }}</span
        >
      </header>
      <p>{{ item.body }}</p>
      <div class="forum-admin-actions">
        <button
          v-if="item.status !== 'deleted'"
          @click="commentAction(item, 'hidden')"
        >
          隐藏</button
        ><button
          v-if="item.status !== 'deleted'"
          @click="commentAction(item, 'published')"
        >
          恢复公开</button
        ><button @click="commentAction(item, 'deleted')">删除</button>
      </div>
    </article>
    <article
      v-for="item in tab === 'reports' ? reports : []"
      :key="item.id"
      class="forum-admin-row"
    >
      <header>
        <RouterLink :to="'/community/' + item.postId">查看被举报帖子</RouterLink
        ><span
          >{{ forumStatus[item.status] }} ·
          {{ item.targetType === 'comment' ? '评论举报' : '帖子举报' }}</span
        >
      </header>
      <p>{{ item.reason }}</p>
      <p v-if="item.resolution">处理结论：{{ item.resolution }}</p>
      <div v-if="item.status === 'open'" class="forum-admin-actions">
        <button @click="resolve(item, 'resolved')">处理完成</button
        ><button @click="resolve(item, 'dismissed')">不予受理</button>
      </div>
    </article>
    <template v-if="tab === 'restrictions'"
      ><form class="member-form" @submit.prevent="saveRestriction">
        <h2>设置或解除发言限制</h2>
        <label
          >成员学号<input
            v-model="restriction.studentId"
            minlength="4"
            maxlength="24"
            required /></label
        ><label class="checkbox-line"
          ><input v-model="restriction.posts" type="checkbox" />限制发帖</label
        ><label
          >发帖限制截止（北京时间，留空持续限制）<input
            v-model="restriction.postsUntil"
            type="datetime-local" /></label
        ><label class="checkbox-line"
          ><input
            v-model="restriction.comments"
            type="checkbox"
          />限制评论</label
        ><label
          >评论限制截止（北京时间，留空持续限制）<input
            v-model="restriction.commentsUntil"
            type="datetime-local" /></label
        ><label
          >原因<textarea
            v-model="restriction.reason"
            minlength="2"
            maxlength="300"
            required
          />
        </label>
        <p>取消两项勾选并保存可解除限制；不改变账号登录或其他系统权限。</p>
        <button class="button button-primary">保存限制</button>
      </form>
      <article
        v-for="item in restrictions"
        :key="item.id"
        class="forum-admin-row"
      >
        <p>成员标识：{{ item.uid }}</p>
        <p>{{ item.reason }}</p>
        <small
          >发帖：{{
            item.posts
              ? item.postsUntil
                ? beijing(item.postsUntil)
                : '持续限制'
              : '正常'
          }}
          · 评论：{{
            item.comments
              ? item.commentsUntil
                ? beijing(item.commentsUntil)
                : '持续限制'
              : '正常'
          }}</small
        >
      </article></template
    >
    <article
      v-for="item in tab === 'audit' ? audit : []"
      :key="item.id"
      class="forum-inbox-row"
    >
      <strong>{{ item.action }}</strong>
      <p v-if="item.details">
        {{
          Object.entries(item.details)
            .map(([key, value]) => key + '：' + String(value))
            .join(' · ')
        }}
      </p>
      <span>目标：{{ item.target }}</span
      ><small>{{ beijing(item.createdAt) }} · 操作者：{{ item.actor }}</small>
    </article>
    <p v-if="!total" class="admin-empty">暂无记录。</p></template
  >
  <div class="forum-pagination">
    <button :disabled="busy || page <= 1" @click="turn(-1)">上一页</button
    ><span>第{{ page }}页 · 共{{ total }}条</span
    ><button :disabled="busy || page * 20 >= total" @click="turn(1)">
      下一页
    </button>
  </div>
</template>
