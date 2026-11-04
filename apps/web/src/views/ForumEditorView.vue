<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ForumBoard, ForumPostView, Page } from '@electronic-club/shared'
import { request } from '../member-api'
import { coverFile } from '../cover'
import { forumImageUrl } from '../forum'
import { useAuthStore } from '../stores/auth'
import SafeMarkdown from '../components/SafeMarkdown.vue'
const route = useRoute(),
  router = useRouter(),
  auth = useAuthStore(),
  boards = ref<ForumBoard[]>([]),
  form = reactive({ title: '', body: '', boardId: '' }),
  images = ref<{ id: string; src: string; staged: boolean }[]>([]),
  busy = ref(false),
  loaded = ref(false),
  saved = ref(false),
  message = ref(''),
  preview = ref(false)
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
    for (const board of result.items)
      if (!boards.value.some((b) => b.id === board.id)) boards.value.push(board)
    boardTotal.value = result.total
    boardPage.value++
  } finally {
    boardBusy.value = false
  }
}
function loadMoreBoards() {
  void moreBoards().catch((e) => {
    message.value = (e as Error).message
  })
}
async function picture(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (busy.value) return
  if (files.length + images.value.length > 3) {
    message.value = '每帖最多3张图片'
    return
  }
  busy.value = true
  message.value = '正在压缩并上传图片…'
  try {
    for (const file of files) {
      const uri = await coverFile(file, true)
      const result = await request<{ id: string }>('/forum/images', 'POST', {
        dataUrl: uri,
      })
      images.value.push({ id: result.id, src: uri, staged: true })
    }
    message.value = '图片已上传，发布帖子后才会公开显示。'
  } catch (e) {
    message.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
async function removeImage(index: number) {
  const image = images.value[index]!
  if (image.staged) {
    try {
      await request('/forum/images/' + image.id + '/delete', 'POST', {})
    } catch (e) {
      message.value = (e as Error).message
      return
    }
  }
  images.value.splice(index, 1)
}
async function submit() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const data = await request<ForumPostView>(
      route.params.id
        ? `/forum/posts/${route.params.id}/update`
        : '/forum/posts',
      'POST',
      { ...form, imageIds: images.value.map((i) => i.id) },
    )
    saved.value = true
    await router.push('/community/' + data.id)
  } catch (e) {
    message.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
onMounted(async () => {
  try {
    await moreBoards()
    const preferred = String(route.query.board ?? 'board-1')
    if (!boards.value.some((b) => b.id === preferred)) {
      try {
        boards.value.push(
          await request<ForumBoard>(
            '/forum/boards/' + encodeURIComponent(preferred),
          ),
        )
      } catch {
        /* unavailable board: choose another public board */
      }
    }
    if (route.params.id) {
      const post = await request<ForumPostView>(
        '/forum/posts/' + route.params.id,
      )
      if (post.authorUid !== auth.member?.uid)
        throw new Error('只能编辑本人帖子')
      Object.assign(form, {
        title: post.title,
        body: post.body,
        boardId: post.boardId,
      })
      if (!boards.value.some((b) => b.id === post.boardId))
        boards.value.push(post.board)
      images.value = post.imageIds.map((id) => ({
        id,
        src: forumImageUrl(id),
        staged: false,
      }))
    } else
      form.boardId =
        boards.value.find(
          (b) =>
            b.id === String(route.query.board ?? 'board-1') &&
            b.status === 'active',
        )?.id ??
        boards.value.find((b) => b.status === 'active')?.id ??
        ''
    loaded.value = true
  } catch (e) {
    message.value = (e as Error).message
  }
})
onBeforeUnmount(() => {
  if (!saved.value)
    for (const image of images.value.filter((i) => i.staged))
      void request('/forum/images/' + image.id + '/delete', 'POST', {}).catch(
        () => {},
      )
})
</script>
<template>
  <section class="container section forum-editor">
    <RouterLink to="/community">← 返回电子社区</RouterLink>
    <p class="eyebrow">SHARE YOUR WORK</p>
    <h1>{{ route.params.id ? '编辑帖子' : '发布讨论' }}</h1>
    <p>把问题、思路和尝试写清楚。请勿公开个人敏感信息。</p>
    <form v-if="loaded" class="member-form" @submit.prevent="submit">
      <label
        >版块<select
          aria-label="版块"
          v-model="form.boardId"
          required
          :disabled="busy"
        >
          <option
            v-for="board in boards"
            :key="board.id"
            :value="board.id"
            :disabled="board.status !== 'active'"
          >
            {{ board.name }}{{ board.requireReview ? '（发布需审核）' : '' }}
          </option>
        </select></label
      ><button
        v-if="boards.length < boardTotal"
        type="button"
        :disabled="busy || boardBusy"
        @click="loadMoreBoards"
      >
        加载更多版块</button
      ><label
        >标题<input
          v-model="form.title"
          minlength="2"
          maxlength="120"
          required
          :disabled="busy" /></label
      ><label
        >正文（标题和列表可用，HTML按文字显示）<textarea
          v-model="form.body"
          rows="14"
          minlength="2"
          maxlength="6000"
          required
          :disabled="busy"
        /></label
      ><label
        >附图（最多3张，单个原文件不超过1MB，自动压缩并分次上传）<input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          :disabled="busy || images.length >= 3"
          @change="picture"
      /></label>
      <div class="forum-editor-images">
        <figure v-for="(image, index) in images" :key="image.id">
          <img :src="image.src" alt="帖子附图预览" /><button
            type="button"
            :disabled="busy"
            @click="removeImage(index)"
          >
            移除图片 {{ index + 1 }}
          </button>
        </figure>
      </div>
      <button type="button" class="text-link" @click="preview = !preview">
        {{ preview ? '关闭预览' : '预览正文' }}</button
      ><SafeMarkdown v-if="preview" :content="form.body" />
      <div class="publication-tools">
        <button class="button button-primary" :disabled="busy">
          {{
            busy ? '正在处理…' : route.params.id ? '保存修改' : '发布帖子'
          }}</button
        ><RouterLink to="/community">取消</RouterLink>
      </div>
    </form>
    <p role="status" aria-live="polite">{{ message }}</p>
  </section>
</template>
