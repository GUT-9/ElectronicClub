<script setup lang="ts">
import { imageSource } from '../media'
import { ref, watch, computed } from 'vue'
import { useRoute } from 'vue-router'
import type {
  ClubEvent,
  ClubArticle,
  Registration,
  EventAccess,
} from '@electronic-club/shared'
import { request } from '../member-api'
import { useAuthStore } from '../stores/auth'
import { useDeliveryStore } from '../stores/delivery'
import { beijing } from '../stage3'
import ContentState from '../components/ContentState.vue'
import { eventLabel } from '../presentation'
import SafeMarkdown from '../components/SafeMarkdown.vue'
const props = defineProps<{ kind: 'events' | 'articles' }>(),
  route = useRoute(),
  auth = useAuthStore(),
  delivery = useDeliveryStore(),
  membershipRequested = ref(false),
  item = ref<ClubEvent | ClubArticle | null>(null),
  registration = ref<Registration | null>(null),
  eventAccess = ref<EventAccess | null>(null),
  error = ref(''),
  message = ref(''),
  note = ref(''),
  code = ref(''),
  busy = ref(false),
  loading = ref(true),
  membershipLoading = ref(false),
  membershipError = ref('')
let generation = 0
const registrationOpen = computed(() => {
  const e = item.value
  if (!e || !('registrationEnabled' in e)) return false
  return (
    e.registrationEnabled &&
    Date.parse(e.registrationDeadline) > Date.now() &&
    (!e.registrationStartsAt ||
      Date.parse(e.registrationStartsAt) <= Date.now()) &&
    (e.capacity === null || e.occupied < e.capacity)
  )
})
async function load() {
  const current = ++generation
  loading.value = !item.value
  error.value = ''
  membershipError.value = ''
  try {
    const loaded = await request<ClubEvent | ClubArticle>(
      `/public/${props.kind}/${route.params.id}`,
    )
    if (current !== generation) return
    item.value = loaded
  } catch (e) {
    if (current === generation) error.value = (e as Error).message
    return
  } finally {
    if (current === generation) loading.value = false
  }
  await delivery.restore()
  if (current !== generation) return
  if (props.kind === 'events' && (delivery.mode === 'database' || membershipRequested.value || route.query.checkin))
    await loadMembership()
}
async function loadMembership() {
  const current = generation
  membershipRequested.value = true
  membershipLoading.value = true
  try {
    await auth.restore(true)
    if (current !== generation) return
    if (props.kind === 'events' && auth.member) {
      const result = await request<Registration>(
        `/events/${route.params.id}/registration`,
      )
      if (current === generation) registration.value = result
      const access = await request<EventAccess>(
        `/events/${route.params.id}/access`,
      )
      if (current === generation) eventAccess.value = access
    }
  } catch {
    if (current === generation)
      membershipError.value = '暂时无法读取你的报名状态，请重试后再操作。'
  } finally {
    if (current === generation) membershipLoading.value = false
  }
}
async function action(path: string, method = 'POST', data: unknown = {}) {
  if (busy.value) return
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
  () => [props.kind, route.params.id, route.query.checkin],
  () => {
    item.value = null
    membershipRequested.value = false
    registration.value = null
    eventAccess.value = null
    code.value =
      typeof route.query.checkin === 'string' &&
      route.query.checkin.length <= 200
        ? route.query.checkin
        : ''
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
    <ContentState v-if="loading" loading /><ContentState
      v-else-if="error"
      error
      title="内容暂时无法打开"
      description="内容可能尚未公开，或网络连接暂时不可用。"
      @retry="load"
    />
    <article v-if="item && !loading && !error" class="publication-detail">
      <header class="publication-detail-header">
        <p class="eyebrow">
          {{ beijing(item.publishedAt) }} · {{ item.publisherName }}
        </p>
        <h1>{{ item.title }}</h1>
        <p v-if="item.summary" class="publication-lead">{{ item.summary }}</p>
      </header>
      <img
        v-if="item.cover"
        :src="imageSource(item.cover)"
        alt="封面"
        class="publication-cover"
      />
      <div v-if="'startsAt' in item" class="event-facts">
        <span class="ui-tag">{{ eventLabel(item) }}</span>
        <div>
          <span>活动时间</span
          ><strong
            >{{ beijing(item.startsAt) }} — {{ beijing(item.endsAt) }}</strong
          >
        </div>
        <div>
          <span>活动地点</span
          ><strong>{{ item.location || '地点待定' }}</strong>
        </div>
      </div>
      <SafeMarkdown :content="item.content" />
      <div
        v-if="kind === 'events' && (eventAccess?.roster || eventAccess?.edit)"
        class="publication-tools"
      >
        <RouterLink
          class="button button-outline"
          :to="{
            path: '/admin/events',
            query: { event: item.id, tab: 'registrations' },
          }"
          >管理此活动 · 报名审核与名单</RouterLink
        >
        <RouterLink
          v-if="eventAccess?.checkin"
          class="text-link"
          :to="{
            path: '/admin/events',
            query: { event: item.id, tab: 'checkin' },
          }"
          >签到管理 →</RouterLink
        >
      </div>
      <section
        v-if="'registrationEnabled' in item && item.registrationEnabled"
        class="registration-panel"
      >
        <h2>活动报名</h2>
        <p>
          报名截止：{{ beijing(item.registrationDeadline) }} · 已占名额
          {{ item.occupied }} / {{ item.capacity ?? '不限' }}
        </p>
        <button v-if="delivery.mode !== 'database' && !membershipRequested" class="button button-primary" @click="loadMembership">
          查看我的报名、签到与管理入口
        </button>
        <p v-else-if="membershipLoading" class="ui-message" role="status">
          正在读取报名状态…
        </p>
        <div v-else-if="membershipError" class="ui-message" role="alert">
          {{ membershipError
          }}<button class="plain-button" @click="load">重新读取</button>
        </div>
        <RouterLink
          v-else-if="!auth.member"
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
            <p>报名将使用你的成员档案信息，无需重复填写。</p>
            <p v-if="!registrationOpen" class="ui-message">
              当前暂不接受新报名，请留意报名时间及剩余名额。
            </p>
            <button
              :disabled="busy || !registrationOpen"
              class="button button-primary"
            >
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
        </template>
        <p role="status">{{ message }}</p>
      </section>
      <section
        v-if="
          kind === 'events' &&
          'checkinEnabled' in item &&
          item.checkinEnabled &&
          auth.member &&
          registration?.status === 'approved'
        "
        class="registration-panel"
      >
        <h2>活动签到</h2>
        <p v-if="registration.checkedInAt">
          已签到：{{ beijing(registration.checkedInAt) }}
        </p>
        <form
          v-else
          class="member-form"
          @submit.prevent="action('checkin', 'POST', { code })"
        >
          <p>请填写活动负责人提供的有效签到码，或打开负责人分享的签到链接。</p>
          <label
            >签到码<input
              v-model="code"
              required
              maxlength="200"
              autocomplete="off" /></label
          ><button
            :disabled="busy || membershipLoading"
            class="button button-primary"
          >
            确认签到
          </button>
        </form>
        <p role="status">{{ message }}</p>
      </section>
    </article>
  </section>
</template>
