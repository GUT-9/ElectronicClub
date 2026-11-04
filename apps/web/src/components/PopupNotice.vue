<script setup lang="ts">
import {imageSource} from '../media'
import { onMounted, onBeforeUnmount, nextTick, ref } from 'vue'
import type { PopupAnnouncement } from '@electronic-club/shared'
import { request } from '../member-api'
import { dismissedPopup, dismissPopup } from '../stage3'
const popup = ref<PopupAnnouncement | null>(null),
  container = ref<HTMLElement | null>(null)
let alive = true,
  previousFocus: HTMLElement | null = null
function keyboard(event: KeyboardEvent) {
  if (!popup.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
  if (event.key === 'Tab' && container.value) {
    const items =
      container.value.querySelectorAll<HTMLElement>('button,a[href]')
    const first = items[0],
      last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
}
onBeforeUnmount(() => {
  alive = false
  window.removeEventListener('keydown', keyboard)
})
onMounted(async () => {
  window.addEventListener('keydown', keyboard)
  try {
    const value = await request<PopupAnnouncement | null>('/public/popup')
    if (alive && value && !dismissedPopup(value.version)) {
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      popup.value = value
      dismissPopup(value.version)
      await nextTick()
      container.value?.querySelector<HTMLElement>('button')?.focus()
    }
  } catch {
    /* Content failures do not block the website. */
  }
})
function close() {
  if (popup.value) dismissPopup(popup.value.version)
  popup.value = null
  previousFocus?.focus()
}
</script>
<template>
  <Teleport to="body"
    ><div v-if="popup" class="popup-shade" @click.self="close">
      <section
        ref="container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="popup-title"
        class="popup-notice"
      >
        <button
          autofocus
          aria-label="关闭公告"
          class="popup-close"
          @click="close"
          @keydown.esc="close"
        >
          关闭 ×
        </button>
        <p class="eyebrow">CLUB NOTICE</p>
        <img v-if="popup.image" :src="imageSource(popup.image)" alt="公告图片" />
        <h2 id="popup-title">{{ popup.title }}</h2>
        <p>{{ popup.summary }}</p>
        <RouterLink
          class="button button-primary"
          :to="`${popup.targetType === 'event' ? '/activities' : '/news'}/${popup.targetId}`"
          @click="close"
          >{{ popup.buttonText }}</RouterLink
        >
      </section>
    </div></Teleport
  >
</template>
<style scoped>
.popup-shade {
  position: fixed;
  inset: 0;
  background: #102c4f77;
  z-index: 300;
  display: grid;
  place-items: center;
  padding: 20px;
}
.popup-notice {
  position: relative;
  background: white;
  border-top: 4px solid var(--blue);
  padding: 36px;
  width: min(100%, 520px);
  max-height: 90dvh;
  overflow: auto;
}
.popup-notice img {
  width: 100%;
  max-height: 250px;
  object-fit: cover;
}
.popup-close {
  float: right;
  border: 0;
  background: none;
  cursor: pointer;
}
.popup-notice p {
  line-height: 1.8;
}
</style>
