<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  DEFAULT_CHECKIN_TTL_SECONDS,
  MAX_CHECKIN_TTL_SECONDS,
} from '@electronic-club/shared'
import type {
  ClubEvent,
  EventAccess,
  EventCheckinState,
  EventRosterSummary,
  Page,
  Registration,
} from '@electronic-club/shared'
import { download, request } from '../member-api'
import { beijing } from '../stage3'
const props = defineProps<{
  eventId: string
  tab: 'registrations' | 'checkin'
}>()
const emit = defineEmits<{ settings: [{ checkinTtlSeconds: number }] }>()
const event = ref<ClubEvent>(),
  access = ref<EventAccess>(),
  state = ref<EventCheckinState>(),
  rows = ref<Registration[]>([]),
  summary = ref<EventRosterSummary>({
    checkedIn: 0,
    notCheckedIn: 0,
    pending: 0,
  }),
  total = ref(0),
  page = ref(1),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  code = ref(''),
  minutes = ref(DEFAULT_CHECKIN_TTL_SECONDS / 60)
const search = ref(''),
  status = ref(''),
  checkedIn = ref(''),
  college = ref(''),
  className = ref(''),
  manualUid = ref(''),
  manualName = ref(''),
  manualStudentId = ref(''),
  reason = ref('')
const labels: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已取消',
  manual: '人工补签',
}
let generation = 0,
  rosterGeneration = 0
const validDuration = computed(
  () =>
    Number.isFinite(minutes.value) &&
    Number.isInteger(minutes.value * 60) &&
    minutes.value * 60 >= 30 &&
    minutes.value * 60 <= MAX_CHECKIN_TTL_SECONDS,
)
const now = ref(Date.now()),
  isOpen = computed(
    () =>
      !!(
        state.value?.open &&
        state.value.expiresAt &&
        Date.parse(state.value.expiresAt) > now.value
      ),
  ),
  checkinLink = computed(
    () =>
      `${window.location.origin}/activities/${props.eventId}?checkin=${encodeURIComponent(code.value)}`,
  )
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onBeforeUnmount(() => {
  if (clock) clearInterval(clock)
  generation++
  rosterGeneration++
})
function resetManual() {
  manualUid.value = ''
  manualName.value = ''
}
function query() {
  return new URLSearchParams({
    page: String(page.value),
    pageSize: '20',
    search: search.value,
    status: status.value,
    checkedIn: checkedIn.value,
    college: college.value,
    className: className.value,
  })
}
async function loadRoster() {
  const id = props.eventId,
    seq = ++rosterGeneration
  loading.value = true
  error.value = ''
  try {
    const result = await request<
      Page<Registration> & { summary: EventRosterSummary }
    >(`/events/${id}/registrations?${query()}`)
    if (id === props.eventId && seq === rosterGeneration) {
      rows.value = result.items
      total.value = result.total
      summary.value = result.summary
    }
  } catch (e) {
    if (id === props.eventId && seq === rosterGeneration)
      error.value = (e as Error).message
  } finally {
    if (id === props.eventId && seq === rosterGeneration) loading.value = false
  }
}
async function init() {
  const seq = ++generation,
    id = props.eventId
  rosterGeneration++
  rows.value = []
  total.value = 0
  summary.value = { checkedIn: 0, notCheckedIn: 0, pending: 0 }
  access.value = undefined
  event.value = undefined
  state.value = undefined
  code.value = ''
  error.value = ''
  notice.value = ''
  page.value = 1
  search.value = ''
  status.value = ''
  checkedIn.value = ''
  college.value = ''
  className.value = ''
  manualUid.value = ''
  manualName.value = ''
  manualStudentId.value = ''
  reason.value = ''
  loading.value = true
  try {
    const [record, capabilities] = await Promise.all([
      request<ClubEvent>(`/events/${id}`),
      request<EventAccess>(`/events/${id}/access`),
    ])
    if (seq !== generation) return
    event.value = record
    access.value = capabilities
    minutes.value =
      (record.checkinTtlSeconds ?? DEFAULT_CHECKIN_TTL_SECONDS) / 60
    if (capabilities.checkin) {
      const current = await request<EventCheckinState>(
        `/events/${id}/checkin-status`,
      )
      if (seq !== generation) return
      state.value = current
      minutes.value = current.ttlSeconds / 60
    }
    if (capabilities.roster) await loadRoster()
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message
  } finally {
    if (seq === generation) loading.value = false
  }
}
async function act(work: () => Promise<void>) {
  if (busy.value || loading.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  const seq = generation
  try {
    await work()
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message
  } finally {
    if (seq === generation) busy.value = false
  }
}
async function review(row: Registration, decision: 'approved' | 'rejected') {
  const id = props.eventId
  await act(async () => {
    await request(`/events/${id}/review`, 'POST', {
      uid: row.uid,
      status: decision,
    })
    if (id !== props.eventId) return
    notice.value = `${row.snapshot.name}的报名已${decision === 'approved' ? '通过' : '拒绝'}。`
    await loadRoster()
  })
}
async function checkin(open: boolean) {
  if (open && !validDuration.value) {
    error.value = '有效期须在0.5至1440分钟之间。'
    return
  }
  const id = props.eventId
  await act(async () => {
    const result = await request<EventCheckinState>(
      `/events/${id}/checkin-code`,
      'POST',
      { open, ...(open ? { ttlSeconds: Math.round(minutes.value * 60) } : {}) },
    )
    if (id !== props.eventId) return
    state.value = result
    code.value = result.code ?? ''
    minutes.value = result.ttlSeconds / 60
    emit('settings', { checkinTtlSeconds: result.ttlSeconds })
    notice.value = open
      ? '签到已开放，新码已生效；此前的签到码同时失效。'
      : '签到已结束，签到码已失效。'
  })
}
async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    notice.value = '已复制'
  } catch {
    error.value = '无法自动复制，请选中签到码手动复制。'
  }
}
function selectManual(row: Registration) {
  manualUid.value = row.uid
  manualName.value = row.snapshot.name
  manualStudentId.value = ''
  document
    .getElementById('event-manual-checkin')
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
async function manual() {
  const id = props.eventId
  await act(async () => {
    let uid = manualUid.value
    if (!uid) {
      const member = await request<{ uid: string; nickname: string }>(
        `/events/${id}/member-lookup?studentId=${encodeURIComponent(manualStudentId.value.trim())}`,
      )
      uid = member.uid
    }
    await request(`/events/${id}/manual-checkin`, 'POST', {
      uid,
      reason: reason.value,
    })
    if (id !== props.eventId) return
    notice.value = '人工补签已完成，并记录操作原因。'
    manualUid.value = ''
    manualName.value = ''
    manualStudentId.value = ''
    reason.value = ''
    await loadRoster()
  })
}
async function exportRows() {
  const id = props.eventId
  await act(() =>
    download(
      `/events/${id}/registrations/export.xlsx?${query()}`,
      `${event.value?.title ?? '活动'}-报名签到名单.xlsx`,
    ),
  )
}
function filterRows() {
  page.value = 1
  void loadRoster()
}
function quickFilter(value: string) {
  status.value = value
  filterRows()
}
function turn(delta: number) {
  page.value += delta
  void loadRoster()
}
watch(
  () => props.eventId,
  () => {
    busy.value = false
    void init()
  },
  { immediate: true },
)
</script>
<template>
  <section class="event-operations" :aria-busy="loading || busy">
    <header class="event-operation-heading">
      <div>
        <p class="eyebrow">
          {{ tab === 'checkin' ? 'EVENT CHECK-IN' : 'REGISTRATION REVIEW' }}
        </p>
        <h2>{{ tab === 'checkin' ? '签到管理' : '报名审核与名单' }}</h2>
        <p v-if="event">{{ event.title }}</p>
      </div>
      <button
        class="button button-outline"
        :disabled="busy || loading"
        @click="loadRoster"
      >
        刷新名单
      </button>
    </header>
    <p v-if="error" role="alert" class="operation-message">{{ error }}</p>
    <p v-if="notice" role="status" class="operation-message">{{ notice }}</p>
    <p v-if="loading" role="status">正在加载活动及报名名单…</p>
    <p v-else-if="access && !access.roster">
      你没有此活动名单的查看权限，请联系活动负责人。
    </p>
    <section
      v-if="tab === 'checkin' && access?.checkin"
      class="event-checkin-card"
    >
      <h3>签到码与有效期</h3>
      <p v-if="!state?.enabled">
        此活动尚未开启签到功能或尚未发布，请先到“活动设置”中启用并保存。
      </p>
      <p v-else>
        自定义签到码有效期，默认30分钟，最长24小时。生成新码后旧码立即失效，结束签到可提前关闭。
      </p>
      <p v-if="isOpen">签到已开放 · 有效至 {{ beijing(state?.expiresAt) }}</p>
      <p v-else>当前未开放有效签到。</p>
      <label class="event-duration"
        >签到码有效期（分钟）<input
          v-model.number="minutes"
          type="number"
          min="0.5"
          max="1440"
          step="0.5"
          :disabled="busy || loading"
      /></label>
      <div class="publication-tools">
        <button
          class="button button-primary"
          :disabled="busy || loading || !state?.enabled || !validDuration"
          @click="checkin(true)"
        >
          {{ isOpen ? '重新生成签到码' : '开启签到并生成签到码' }}</button
        ><button
          class="button button-outline"
          :disabled="busy || loading || !isOpen"
          @click="checkin(false)"
        >
          结束签到
        </button>
      </div>
      <div v-if="code" class="event-code">
        <label
          >当前签到码<input
            :value="code"
            readonly
            @focus="($event.target as HTMLInputElement).select()"
        /></label>
        <div class="publication-tools">
          <button :disabled="busy || !isOpen" @click="copy(code)">
            复制签到码</button
          ><button :disabled="busy || !isOpen" @click="copy(checkinLink)">
            复制签到链接
          </button>
        </div>
        <p>
          成员需先登录并通过报名审核，打开签到链接后仍需本人确认签到。<span
            v-if="!isOpen"
          >
            此码已失效，请重新生成。</span
          >
        </p>
      </div>
      <p v-else-if="isOpen">
        现有码仍在有效期内；需要分享新码时，请点击“重新生成签到码”。
      </p>
    </section>
    <template v-if="access?.roster">
      <div class="event-roster-summary">
        <span
          >筛选结果 <strong>{{ total }}</strong> 人</span
        ><span
          >待审核 <strong>{{ summary.pending }}</strong></span
        ><span
          >已签到 <strong>{{ summary.checkedIn }}</strong></span
        ><span
          >未签到 <strong>{{ summary.notCheckedIn }}</strong></span
        >
      </div>
      <div class="publication-tools">
        <button
          :class="{ 'active-filter': !status }"
          :disabled="busy || loading"
          @click="quickFilter('')"
        >
          全部名单</button
        ><button
          :class="{ 'active-filter': status === 'pending' }"
          :disabled="busy || loading"
          @click="quickFilter('pending')"
        >
          待审核</button
        ><button
          :class="{ 'active-filter': status === 'approved' }"
          :disabled="busy || loading"
          @click="quickFilter('approved')"
        >
          已通过</button
        ><button
          v-if="access.export"
          :disabled="busy || loading"
          @click="exportRows"
        >
          导出筛选结果 XLSX
        </button>
      </div>
      <form class="event-roster-filters" @submit.prevent="filterRows">
        <label>姓名或学号<input v-model="search" maxlength="100" /></label
        ><label>学院<input v-model="college" maxlength="100" /></label
        ><label>班级<input v-model="className" maxlength="100" /></label
        ><label
          >报名状态<select v-model="status">
            <option value="">全部状态</option>
            <option
              v-for="(label, value) in labels"
              :key="value"
              :value="value"
            >
              {{ label }}
            </option>
          </select></label
        ><label
          >签到状态<select v-model="checkedIn">
            <option value="">全部签到状态</option>
            <option value="yes">已签到</option>
            <option value="no">未签到</option>
          </select></label
        ><button class="button button-outline" :disabled="busy || loading">
          筛选名单
        </button>
      </form>
      <p class="event-roster-scroll-note">左右滑动可查看完整名单与操作。</p>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>姓名 / 学号</th>
              <th>学院 / 班级</th>
              <th>报名时间</th>
              <th>报名状态</th>
              <th>签到状态</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td>
                <strong>{{ row.snapshot.name }}</strong
                ><small>{{ row.snapshot.studentId }}</small>
              </td>
              <td>
                {{ row.snapshot.college
                }}<small>{{ row.snapshot.className }}</small>
              </td>
              <td>{{ beijing(row.registeredAt) }}</td>
              <td>
                <span class="ui-tag">{{ labels[row.status] }}</span>
              </td>
              <td>
                {{ row.checkedInAt ? beijing(row.checkedInAt) : '未签到' }}
              </td>
              <td>{{ row.note || '—' }}</td>
              <td>
                <div class="publication-tools">
                  <template v-if="access.review && row.status === 'pending'"
                    ><button
                      :disabled="busy || loading"
                      @click="review(row, 'approved')"
                    >
                      通过报名</button
                    ><button
                      :disabled="busy || loading"
                      @click="review(row, 'rejected')"
                    >
                      拒绝报名
                    </button></template
                  ><button
                    v-if="
                      tab === 'checkin' && access.checkin && !row.checkedInAt
                    "
                    :disabled="busy || loading || !state?.enabled"
                    @click="selectManual(row)"
                  >
                    为此成员补签</button
                  ><span v-if="row.status !== 'pending' && tab !== 'checkin'"
                    >已处理</span
                  >
                </div>
              </td>
            </tr>
            <tr v-if="!loading && !rows.length">
              <td colspan="7">
                当前没有符合条件的报名记录。成员提交报名后会自动出现在名单中，可点击“刷新名单”更新。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="publication-tools event-roster-pagination">
        <button :disabled="busy || loading || page === 1" @click="turn(-1)">
          上一页</button
        ><span>第 {{ page }} 页 · 每页20人 · 共{{ total }}人</span
        ><button
          :disabled="busy || loading || page * 20 >= total"
          @click="turn(1)"
        >
          下一页
        </button>
      </div>
    </template>
    <form
      v-if="tab === 'checkin' && access?.checkin"
      id="event-manual-checkin"
      class="event-checkin-card member-form"
      @submit.prevent="manual"
    >
      <h3>人工补签</h3>
      <p>
        可从上方名单选择成员。补签待审核报名会同时通过审核；已拒绝、取消或未报名成员将记为人工补签，不占普通报名名额。必须填写原因。
      </p>
      <p v-if="manualUid">
        已选择：{{ manualName }}
        <button type="button" :disabled="busy" @click="resetManual">
          重新选择
        </button>
      </p>
      <label v-else
        >未在当前页名单中的成员学号<input
          v-model="manualStudentId"
          required
          maxlength="24" /></label
      ><label>补签原因<input v-model="reason" required maxlength="500" /></label
      ><button
        class="button button-outline"
        :disabled="busy || loading || !state?.enabled"
      >
        确认人工补签
      </button>
    </form>
  </section>
</template>
<style scoped>
.event-operations {
  margin: 24px 0;
}
.event-roster-scroll-note {
  display: none;
  font-size: 12px;
  color: var(--muted);
}
@media (max-width: 600px) {
  .event-roster-scroll-note {
    display: block;
  }
}
.event-operation-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.event-operation-heading h2 {
  margin: 6px 0;
  font-size: 26px;
}
.event-operation-heading p {
  margin: 8px 0;
}
.event-roster-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 22px 0;
}
.event-roster-summary span {
  padding: 16px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 13px;
}
.event-roster-summary strong {
  display: block;
  font-size: 26px;
  color: var(--ink);
  margin-top: 8px;
}
.event-roster-filters {
  display: flex;
  gap: 10px;
  align-items: end;
  flex-wrap: wrap;
  margin: 20px 0;
}
.event-roster-filters label {
  display: grid;
  gap: 7px;
  flex: 1 1 125px;
  font-size: 13px;
}
.event-roster-filters input,
.event-roster-filters select,
.event-duration input,
.event-code input {
  width: 100%;
  min-width: 0;
  padding: 11px;
  border: 1px solid var(--line);
  border-radius: 6px;
  font: inherit;
}
.event-checkin-card {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 24px;
  margin: 22px 0;
  max-width: none;
}
.event-checkin-card h3 {
  margin-top: 0;
}
.event-checkin-card p {
  font-size: 14px;
  line-height: 1.9;
}
.event-duration {
  display: grid;
  gap: 8px;
  max-width: 260px;
  font-size: 14px;
  margin: 18px 0;
}
.event-code {
  border-top: 1px solid var(--line);
  padding-top: 20px;
  margin-top: 20px;
}
.event-code input {
  font-family: monospace;
  color: var(--blue);
}
.event-operations td small {
  display: block;
  color: var(--muted);
  font-size: 12px;
  margin-top: 5px;
}
.event-operations .admin-table {
  min-width: 850px;
}
.event-operations .active-filter {
  background: var(--blue);
  color: #fff;
}
.event-roster-pagination {
  justify-content: center;
  margin-top: 20px;
}
.event-operations .publication-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.event-operations button {
  cursor: pointer;
}
.event-operations [role='alert'] {
  color: #b92d38;
}
@media (max-width: 600px) {
  .event-roster-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .event-checkin-card {
    padding: 16px;
  }
  .event-operation-heading h2 {
    font-size: 23px;
  }
  .event-operations .admin-table-wrap {
    max-width: 100%;
    overflow: auto;
  }
  .event-roster-filters label {
    flex-basis: calc(50% - 10px);
  }
  .event-roster-filters button {
    width: 100%;
  }
}
</style>
