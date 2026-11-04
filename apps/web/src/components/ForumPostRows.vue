<script setup lang="ts">
import type { ForumPostView } from '@electronic-club/shared'
import { beijing } from '../stage3'
defineProps<{ items: ForumPostView[] }>()
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
          <span v-if="post.pinned">置顶</span
          ><span v-if="post.featured">精华</span
          ><span v-if="post.locked">已锁定</span
          ><span>{{ post.board.name }}</span>
        </div>
        <h2>
          <RouterLink :to="'/community/' + post.id">{{
            post.title
          }}</RouterLink>
        </h2>
        <p>{{ post.body.slice(0, 120) }}</p>
        <small
          >{{ post.author.nickname }} · {{ beijing(post.createdAt) }} ·
          {{ post.likeCount }} 赞</small
        >
      </div>
    </article>
  </div>
</template>
