<script setup lang="ts">
import type { ForumPostView } from '@electronic-club/shared'
import { forumStatus } from '../forum'
import { excerpt } from '../presentation'
import { beijing } from '../stage3'
defineProps<{ items: ForumPostView[]; memberPreview?: boolean }>()
</script>
<template>
  <div class="forum-post-rows">
    <article v-for="post in items" :key="post.id" class="forum-post-row">
      <div class="forum-reply-count">
        <strong>{{ post.commentCount }}</strong
        ><span>回复</span>
      </div>
      <div class="forum-post-main">
        <div class="forum-post-flags">
          <span v-if="post.status !== 'published'">{{
            forumStatus[post.status] || post.status
          }}</span
          ><span v-if="post.pinned">置顶</span
          ><span v-if="post.featured">精华</span
          ><span v-if="post.locked">已锁定</span
          ><span>{{ post.board.name }}</span>
        </div>
        <h2>
          <RouterLink :to="'/community/' + post.id + (memberPreview ? '?preview=member' : '')">{{
            post.title
          }}</RouterLink>
        </h2>
        <p>{{ excerpt(post.body) || '查看完整讨论与正文图片' }}</p>
        <small
          >{{ post.author.nickname }} · {{ beijing(post.createdAt) }} ·
          {{ post.likeCount }} 赞</small
        >
      </div>
    </article>
  </div>
</template>
