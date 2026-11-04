<script setup lang="ts">
import { computed, nextTick, ref, onBeforeUnmount } from 'vue'
import { bodyMedia, MAX_BODY_IMAGES, imageLine } from '@electronic-club/shared'
import { uploadImage, mediaUrl } from '../media'
import { request } from '../member-api'
import SafeMarkdown from './SafeMarkdown.vue'
const props = withDefaults(
  defineProps<{
    modelValue: string
    disabled?: boolean
    maxlength?: number
    required?: boolean
    minlength?: number
  }>(),
  { maxlength: 100000, minlength: 0 },
)
const emit = defineEmits<{
  'update:modelValue': [value: string]
  busy: [value: boolean]
}>()
const area = ref<HTMLTextAreaElement>(),
  busy = ref(false),
  message = ref(''),
  preview = ref(false),
  previews = ref<Record<string, string>>({})
let active = true
onBeforeUnmount(() => {
  active = false
})
const attachments = computed(() => bodyMedia(props.modelValue))
function removeImage(id: string) {
  emit(
    'update:modelValue',
    props.modelValue
      .split('\n')
      .filter((line) => imageLine(line)?.id !== id)
      .join('\n'),
  )
}
const count = computed(() => bodyMedia(props.modelValue).length)
function update(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}
async function insert(e: Event) {
  const input = e.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  if (count.value >= MAX_BODY_IMAGES) {
    message.value = '每篇正文最多12张图片'
    return
  }
  const start = area.value?.selectionStart ?? props.modelValue.length,
    end = area.value?.selectionEnd ?? start,
    original = props.modelValue
  busy.value = true
  emit('busy', true)
  message.value = '正在压缩并上传图片…'
  try {
    const image = await uploadImage(file)
    if (!active) {
      void request(`/media/${image.id}/delete`, 'POST', {}).catch(() => {})
      return
    }
    const insertion = `\n![正文图片](${image.reference})\n`
    const next = original.slice(0, start) + insertion + original.slice(end)
    if (next.length > props.maxlength) {
      await request(`/media/${image.id}/delete`, 'POST', {})
      throw new Error('正文长度不足以插入图片，请先缩短正文')
    }
    previews.value[image.id] = image.preview
    emit('update:modelValue', next)
    await nextTick()
    area.value?.focus()
    area.value?.setSelectionRange(
      start + insertion.length,
      start + insertion.length,
    )
    message.value = `图片已插入光标位置，压缩后 ${(image.bytes / 1024).toFixed(1)}KB。保存内容后公开显示。`
  } catch (e) {
    message.value = (e as Error).message
  } finally {
    busy.value = false
    emit('busy', false)
    await nextTick()
    if (active) area.value?.focus()
  }
}
</script>
<template>
  <section class="content-editor">
    <div class="content-editor-bar">
      <strong>正文</strong>
      <div>
        <label
          class="content-image-button"
          :class="{ disabled: disabled || busy || count >= MAX_BODY_IMAGES }"
          >插入图片<input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            :disabled="disabled || busy || count >= MAX_BODY_IMAGES"
            @change="insert" /></label
        ><button type="button" class="plain-button" :disabled="disabled||busy||(!preview&&required&&modelValue.length<Math.max(1,minlength))" @click="preview = !preview">
          {{ preview ? '继续编辑' : '预览正文' }}
        </button>
      </div>
    </div>
    <p class="content-editor-help">
      支持标题（#）、列表（-）、表格和正文图片。原图不超过3MB，自动压缩至50KB以内；每篇最多12张。HTML按文字显示。
    </p>
    <textarea
      v-show="!preview"
      ref="area"
      aria-label="正文"
      :value="modelValue"
      @input="update"
      :maxlength="maxlength"
      :minlength="minlength"
      :required="required"
      :disabled="disabled || busy"
      rows="14"
      placeholder="在这里写正文，将光标放在需要的位置后点击“插入图片”…"
    />
    <div
      v-if="attachments.length && !preview"
      class="content-attachments"
      aria-label="正文图片列表"
    >
      <div v-for="(id, index) in attachments" :key="id">
        <img
          :src="previews[id] ?? mediaUrl(id)"
          :alt="`正文图片 ${index + 1}`"
        /><span>图片 {{ index + 1 }}</span
        ><button
          type="button"
          class="plain-button"
          :disabled="disabled || busy"
          @click="removeImage(id)"
        >
          从正文移除
        </button>
      </div>
    </div>
    <SafeMarkdown
      v-if="preview"
      :content="modelValue"
      :image-previews="previews"
    />
    <p
      v-if="message"
      class="content-editor-message"
      role="status"
      aria-live="polite"
    >
      {{ message }}
    </p>
  </section>
</template>
<style scoped>
.content-editor {
  border: 1px solid var(--line, #dce4ef);
  border-radius: 8px;
  background: white;
  overflow: hidden;
  min-width: 0;
}
.content-editor-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #f6f8fc;
  border-bottom: 1px solid var(--line, #dce4ef);
}
.content-editor-bar > div {
  display: flex;
  align-items: center;
  gap: 12px;
}
.content-image-button {
  cursor: pointer;
  color: var(--blue, #2255cc);
  font-size: 13px;
  position: relative;
  overflow: hidden;
  display: inline-block !important;
}
.content-image-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  width: 100%;
  height: 100%;
}
.content-image-button.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.content-editor-help {
  padding: 8px 16px;
  margin: 0;
  font-size: 12px;
  color: #62788e;
  line-height: 1.8;
}
.content-editor textarea {
  border: 0 !important;
  border-radius: 0;
  display: block;
  width: 100%;
  box-sizing: border-box;
  min-height: 260px;
  padding: 16px !important;
  background: white;
  font: inherit;
  line-height: 1.8;
  resize: vertical;
}
.content-editor .safe-markdown {
  padding: 16px;
  min-height: 200px;
}
.content-editor-message {
  margin: 0;
  padding: 10px 16px;
  background: #edf5ff;
  font-size: 13px;
  line-height: 1.8;
}
@media (max-width: 480px) {
  .content-editor-bar {
    padding: 10px;
  }
  .content-editor-bar > div {
    gap: 8px;
  }
}
.content-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid #e1e8f2;
  background: #f9fbfe;
}
.content-attachments > div {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 6px 12px;
  align-items: center;
  padding: 8px;
  border: 1px solid #dce4ef;
  border-radius: 6px;
  background: white;
  font-size: 12px;
}
.content-attachments img {
  width: 64px;
  height: 50px;
  object-fit: contain;
  grid-row: span 2;
}
.content-attachments button {
  padding: 0;
  text-align: left;
  font-size: 12px;
}
</style>
