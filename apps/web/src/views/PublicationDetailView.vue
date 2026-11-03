<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type {
  ClubEvent,
  ClubArticle,
  Registration,
} from '@electronic-club/shared'
import { request } from '../member-api'
import { useAuthStore } from '../stores/auth'
import { beijing } from '../stage3'
import SafeMarkdown from '../components/SafeMarkdown.vue'
const props = defineProps<{ kind: 'events' | 'articles' }>(),
  route = useRoute(),
  auth = useAuthStore(),
  item = ref<ClubEvent | ClubArticle | null>(null),
  registration = ref<Registration | null>(null),
  error = ref(''),
  message = ref(''),
  note = ref(''),
  code = ref(''),
  busy = ref(false)
let generation = 0
async function load() {
  const current = ++generation
  try {
    const loaded = await request<ClubEvent | ClubArticle>(
      `/public/${props.kind}/${route.params.id}`,
    )
    if (current !== generation) return
    item.value = loaded
    await auth.restore(true)
    if (current !== generation) return
    if (props.kind === 'events' && auth.member)
      registration.value = await request(
        `/events/${route.params.id}/registration`,
      )
  } catch (e) {
    if (current === generation) error.value = (e as Error).message
  }
}
async function action(path: string, method = 'POST', data: unknown = {}) {
  busy.value = true
  message.value = ''
  try {
    await request(`/events/${route.params.id}/${path}`, method, data)
    message.value = '操作成功'
    await load()
  } catch (e) {
    message.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
watch(
  () => [props.kind, route.params.id],
  () => {
    item.value = null
    registration.value = null
    error.value = ''
    message.value = ''
    void load()
  },
  { immediate: true },
)
</script>
<template>
  <section class="section container detail-page">
    <RouterLink :to="kind === 'events' ? '/activities' : '/news'"
      >← 返回列表</RouterLink
    >
    <p v-if="error" role="alert">{{ error }}</p>
    <article v-if="item" class="publication-detail">
      <p class="eyebrow">
        {{ beijing(item.publishedAt) }} · {{ item.publisherName }}
      </p>
      <h1>{{ item.title }}</h1>
      <p>{{ item.summary }}</p>
      <img
        v-if="item.cover"
        :src="item.cover"
        alt="封面"
        class="publication-cover"
      /><template v-if="'startsAt' in item"
        ><p>
          活动时间：{{ beijing(item.startsAt) }} — {{ beijing(item.endsAt) }}
        </p>
        <p>地点：{{ item.location }}</p></template
      ><SafeMarkdown :content="item.content" />
      <section
        v-if="'registrationEnabled' in item && item.registrationEnabled"
        class="registration-panel"
      >
        <h2>活动报名</h2>
        <p>
          报名截止：{{ beijing(item.registrationDeadline) }} · 已占名额
          {{ item.occupied }} / {{ item.capacity ?? '不限' }}
        </p>
        <RouterLink
          v-if="!auth.member"
          class="button button-primary"
          :to="`/login?next=${encodeURIComponent(route.fullPath)}`"
          >登录后报名</RouterLink
        ><template v-else
          ><p v-if="registration">
            我的报名状态：{{
              {
                pending: '待审核',
                approved: '已通过',
                rejected: '已拒绝',
                cancelled: '已取消',
                manual: '管理员补签',
              }[registration.status]
            }}
            · {{ registration.checkedInAt ? '已签到' : '未签到' }}
          </p>
          <form
            v-if="
              !registration ||
              ['rejected', 'cancelled'].includes(registration.status)
            "
            class="member-form"
            @submit.prevent="action('registration', 'POST', { note })"
          >
            <label v-if="item.notesEnabled"
              >报名备注 {{ item.notesRequired ? '（必填）' : ''
              }}<textarea
                v-model="note"
                :required="item.notesRequired"
                maxlength="2000"
              />
            </label>
            <p>身份资料使用已绑定成员档案，不能在此修改。</p>
            <button :disabled="busy" class="button button-primary">
              提交报名
            </button>
          </form>
          <button
            v-else-if="item.allowCancellation && !registration.checkedInAt"
            class="button button-outline"
            :disabled="busy"
            @click="action('registration', 'DELETE')"
          >
            取消报名
          </button>
          <form
            v-if="
              item.checkinEnabled &&
              registration?.status === 'approved' &&
              !registration.checkedInAt
            "
            class="member-form"
            @submit.prevent="action('checkin', 'POST', { code })"
          >
            <label
              >签到码<input v-model="code" required maxlength="200" /></label
            ><button :disabled="busy" class="button button-primary">
              签到
            </button>
          </form></template
        >
        <p role="status">{{ message }}</p>
      </section>
    </article>
  </section>
</template>
