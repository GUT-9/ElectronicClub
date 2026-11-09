<script setup lang="ts">
import { ref, reactive, onMounted, watch, computed, nextTick } from 'vue'
import type {
  ClubEvent,
  ClubArticle,
  PopupAnnouncement,
  Page,
} from '@electronic-club/shared'
import { request } from '../member-api'
import { useRoute } from 'vue-router'
import { DEFAULT_CHECKIN_TTL_SECONDS } from '@electronic-club/shared'
import EventManagerPicker from '../components/EventManagerPicker.vue'
import EventOperations from '../components/EventOperations.vue'
import { savePublication } from '../publication-api'
import { fitCover } from '../cover'
import { uploadImage, imageSource } from '../media'
import ContentEditor from '../components/ContentEditor.vue'
import { beijing, localTime, utcTime } from '../stage3'
import { useAuthStore } from '../stores/auth'
const popupFilter = ref('all'),
  currentPopup = ref<PopupAnnouncement | null>(null)
const statusLabels: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  disabled: '已停用',
  withdrawn: '已撤回',
  deleted: '已删除',
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已取消',
  manual: '补签（未报名）',
}
const popupLabels: Record<string, string> = {
  active: '当前有效',
  scheduled: '待生效',
  retired: '历史',
  disabled: '已停用',
}
const displayedRows = computed(() =>
  props.kind === 'popups' && popupFilter.value !== 'all'
    ? rows.value.filter(
        (row) => 'state' in row && row.state === popupFilter.value,
      )
    : rows.value,
)
const listFilter = reactive({ search: '', status: '', category: '' })
const route = useRoute()
const props = defineProps<{ kind: 'events' | 'articles' | 'popups' }>(),
  auth = useAuthStore()
const rows = ref<(ClubEvent | ClubArticle | PopupAnnouncement)[]>([]),
  coverInput = ref<HTMLInputElement | null>(null),
  coverMessage = ref(''),
  selected = ref(''),
  message = ref(''),
  busy = ref(false),
  page = ref(1),
  total = ref(0),
  managerIds = ref<string[]>([]),
  savedManagerIds = ref<string[]>([]),
  managerBusy = ref(false),
  workspaceTab = ref<'settings' | 'registrations' | 'checkin'>('settings')
const form = reactive({
  title: '',
  summary: '',
  content: '',
  cover: '',
  location: '',
  startsAt: '',
  endsAt: '',
  status: 'draft',
  registrationEnabled: false,
  registrationStartsAt: '',
  registrationDeadline: '',
  capacity: null as number | null,
  allowCancellation: true,
  approvalRequired: false,
  notesEnabled: false,
  notesRequired: false,
  checkinEnabled: false,
  checkinTtlSeconds: DEFAULT_CHECKIN_TTL_SECONDS,
  category: '公告',
  pinned: false,
  image: '',
  buttonText: '查看详情',
  targetType: 'event',
  targetId: '',
  expiresAt: '',
  priority: 0,
})
function reset() {
  coverMessage.value = ''
  if (coverInput.value) coverInput.value.value = ''
  selected.value = ''
  managerBusy.value = false
  announce.value = false
  Object.assign(form, {
    title: '',
    summary: '',
    content: '',
    cover: '',
    location: '',
    startsAt: '',
    endsAt: '',
    status: 'draft',
    registrationEnabled: false,
    registrationStartsAt: '',
    registrationDeadline: '',
    capacity: null,
    allowCancellation: true,
    approvalRequired: false,
    notesEnabled: false,
    notesRequired: false,
    checkinEnabled: false,
    checkinTtlSeconds: DEFAULT_CHECKIN_TTL_SECONDS,
    category: '公告',
    pinned: false,
    image: '',
    buttonText: '查看详情',
    targetType: 'event',
    targetId: '',
    expiresAt: '',
    priority: 0,
  })
  managerIds.value =
    props.kind === 'events' && auth.member ? [auth.member.uid] : []
  savedManagerIds.value = []
  workspaceTab.value = 'settings'
  Object.assign(notice, {
    title: '',
    summary: '',
    image: '',
    startsAt: localTime(new Date().toISOString()),
    expiresAt: localTime(new Date(Date.now() + 7 * 86400000).toISOString()),
  })
}
const isManager = computed(
  () =>
    props.kind === 'events' &&
    savedManagerIds.value.includes(auth.member?.uid ?? ''),
)
const checkinMinutes = computed({
  get: () => form.checkinTtlSeconds / 60,
  set: (value: number) => {
    form.checkinTtlSeconds = value * 60
  },
})
const scoped = (permission: string) => auth.can(permission) || isManager.value
const canSave = computed(() =>
  props.kind === 'popups'
    ? auth.can('announcements.popup.manage')
    : props.kind === 'events'
      ? selected.value
        ? scoped('events.edit')
        : auth.can('events.create')
      : auth.can(selected.value ? 'articles.edit' : 'articles.create'),
)
const announce = ref(false),
  notice = reactive({
    title: '',
    summary: '',
    image: '',
    buttonText: '查看详情',
    startsAt: localTime(new Date().toISOString()),
    expiresAt: localTime(new Date(Date.now() + 7 * 86400000).toISOString()),
  })
async function run(work: () => Promise<void>) {
  if (busy.value) return false
  busy.value = true
  message.value = ''
  try {
    await work()
    return true
  } catch (e) {
    message.value = (e as Error).message
    return false
  } finally {
    busy.value = false
  }
}
async function load() {
  return await run(async () => {
    if (props.kind === 'popups') {
      const result = await request<{
        items: PopupAnnouncement[]
        current: PopupAnnouncement | null
      }>('/popups')
      rows.value = result.items
      currentPopup.value = result.current
      total.value = rows.value.length
    } else {
      const data = await request<Page<ClubEvent | ClubArticle>>(
        `/${props.kind}?page=${page.value}&${new URLSearchParams(listFilter)}`,
      )
      rows.value = data.items
      total.value = data.total
    }
  })
}
function edit(
  row: ClubEvent | ClubArticle | PopupAnnouncement,
  tab: 'settings' | 'registrations' | 'checkin' = 'settings',
) {
  reset()
  selected.value = row.id
  for (const key of Object.keys(form)) {
    if (key in row)
      (form as unknown as Record<string, unknown>)[key] = (
        row as unknown as Record<string, unknown>
      )[key]
  }
  if ('managerIds' in row) {
    managerIds.value = [...row.managerIds]
    savedManagerIds.value = [...row.managerIds]
    workspaceTab.value = tab
  }
  for (const key of [
    'startsAt',
    'endsAt',
    'registrationStartsAt',
    'registrationDeadline',
    'expiresAt',
  ] as const)
    form[key] = localTime(form[key])
  if (props.kind === 'events')
    void nextTick(() =>
      document
        .querySelector('.event-workspace-tabs')
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    )
}
function payload() {
  if (props.kind === 'events')
    return {
      title: form.title,
      summary: form.summary,
      content: form.content,
      cover: form.cover,
      location: form.location,
      startsAt: utcTime(form.startsAt),
      endsAt: utcTime(form.endsAt),
      status: form.status,
      registrationEnabled: form.registrationEnabled,
      registrationStartsAt: utcTime(form.registrationStartsAt),
      registrationDeadline: utcTime(form.registrationDeadline),
      capacity:
        form.capacity === null || (form.capacity as unknown) === ''
          ? null
          : Number(form.capacity),
      allowCancellation: form.allowCancellation,
      approvalRequired: form.approvalRequired,
      notesEnabled: form.notesEnabled,
      notesRequired: form.notesRequired,
      checkinEnabled: form.checkinEnabled,
      checkinTtlSeconds: form.checkinTtlSeconds,
      managerIds: [...managerIds.value],
    }
  if (props.kind === 'articles')
    return {
      title: form.title,
      summary: form.summary,
      content: form.content,
      cover: form.cover,
      category: form.category,
      pinned: form.pinned,
      status: form.status,
    }
  return {
    title: form.title,
    summary: form.summary,
    image: form.image,
    buttonText: form.buttonText,
    targetType: form.targetType,
    targetId: form.targetId,
    startsAt: utcTime(form.startsAt),
    expiresAt: utcTime(form.expiresAt),
    priority: Number(form.priority),
  }
}
function setEditorBusy(value: boolean) {
  busy.value = value
}
async function save() {
  if (managerBusy.value) {
    message.value = '正在加载负责人名单，请稍候再保存。'
    return
  }
  const saved = await run(async () => {
    if (props.kind === 'popups') form.image = await fitCover(form.image)
    else form.cover = await fitCover(form.cover)
    if (announce.value) notice.image = await fitCover(notice.image)
    const body = payload()
    const record =
      props.kind === 'popups'
        ? await request<{ id: string; managerIds?: string[] }>(
            '/popups',
            'POST',
            body,
          )
        : await savePublication(
            props.kind,
            selected.value,
            { ...body, cover: form.cover },
            request,
            (saved) => {
              selected.value = saved.id
            },
          )
    selected.value = record.id
    if (record.managerIds) {
      managerIds.value = [...record.managerIds]
      savedManagerIds.value = [...record.managerIds]
    }
    message.value = '已保存'
    coverMessage.value = form.cover
      ? '封面已保存，并已从服务器重新读取确认。'
      : ''
    if (announce.value && props.kind !== 'popups') {
      try {
        await request('/popups', 'POST', {
          title: notice.title || form.title,
          summary: notice.summary || form.summary,
          image: notice.image || form.cover,
          buttonText: notice.buttonText,
          targetType: props.kind === 'events' ? 'event' : 'article',
          targetId: record.id,
          startsAt: utcTime(notice.startsAt),
          expiresAt: utcTime(notice.expiresAt),
          priority: 0,
        })
      } catch (e) {
        throw new Error('内容已保存，弹窗创建失败：' + (e as Error).message)
      }
    }
  })
  if (saved) {
    const refreshed = await load()
    message.value = refreshed
      ? '已保存'
      : '内容已保存，但列表刷新失败：' + message.value
  }
}
async function publishArticle(publish: boolean) {
  const ok = await run(async () => {
    await request(`/articles/${selected.value}/publish`, 'POST', { publish })
    form.status = publish ? 'published' : 'withdrawn'
  })
  if (ok) await load()
}
async function remove() {
  if (!confirm('确认删除这条内容？历史记录将保留。')) return
  const ok = await run(async () => {
    await request(`/${props.kind}/${selected.value}`, 'DELETE')
    reset()
  })
  if (ok) await load()
}
async function picture(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) {
    coverMessage.value = '正在读取并压缩图片…'
    const ok = await run(async () => {
      const image = await uploadImage(file)
      if (props.kind === 'popups') form.image = image.reference
      else form.cover = image.reference
    })
    coverMessage.value = ok
      ? '图片已压缩至50KB以内并上传，尚未保存。请点击下方“保存”。'
      : message.value
    ;(e.target as HTMLInputElement).value = ''
  }
}
function invalidField(e: Event) {
  const field = e.target as HTMLInputElement
  message.value = `尚未保存：${field.validationMessage}，请检查标记的必填项。`
}
async function toggle(row: PopupAnnouncement) {
  const ok = await run(async () => {
    await request(`/popups/${row.id}`, 'PATCH', { enabled: !row.enabled })
  })
  if (ok) await load()
}
watch(
  () => props.kind,
  () => {
    reset()
    page.value = 1
    void load()
  },
)
async function openQueryEvent() {
  if (props.kind !== 'events' || typeof route.query.event !== 'string') return
  const id = route.query.event
  const tab =
    route.query.tab === 'checkin'
      ? 'checkin'
      : route.query.tab === 'settings'
        ? 'settings'
        : 'registrations'
  if (selected.value === id) {
    workspaceTab.value = tab
    return
  }
  await run(async () => {
    const row = await request<ClubEvent>(`/events/${encodeURIComponent(id)}`)
    edit(row, tab)
  })
}
watch(
  () => [route.query.event, route.query.tab],
  () => {
    void openQueryEvent()
  },
)
onMounted(async () => {
  await load()
  await openQueryEvent()
})
function updateCheckinSettings(value: { checkinTtlSeconds: number }) {
  form.checkinTtlSeconds = value.checkinTtlSeconds
}
function searchRows() {
  page.value = 1
  void load()
}
function turn(n: number) {
  page.value += n
  void load()
}
</script>
<template>
  <div class="stage3-workspace">
    <p class="eyebrow">CLUB WORKSPACE</p>
    <h1>
      {{
        kind === 'events'
          ? '活动与报名'
          : kind === 'articles'
            ? '新闻公告管理'
            : '全站弹窗管理'
      }}
    </h1>
    <p>时间均按北京时间填写和显示，提交后由服务端校验。</p>
    <p
      v-if="message"
      class="operation-message"
      role="status"
      aria-live="polite"
    >
      {{ message }}
    </p>
    <div class="publication-tools">
      <button
        v-if="
          auth.can(
            kind === 'events'
              ? 'events.create'
              : kind === 'articles'
                ? 'articles.create'
                : 'announcements.popup.manage',
          )
        "
        class="button button-primary"
        :disabled="busy || managerBusy"
        @click="reset"
      >
        新建{{
          kind === 'events' ? '活动' : kind === 'articles' ? '文章' : '弹窗'
        }}</button
      ><button class="button button-outline" @click="load">刷新列表</button>
    </div>
    <form
      v-if="kind !== 'popups'"
      class="publication-tools"
      @submit.prevent="searchRows"
    >
      <input v-model="listFilter.search" placeholder="搜索标题" /><input
        v-if="kind === 'articles'"
        v-model="listFilter.category"
        placeholder="分类"
      /><select v-model="listFilter.status">
        <option value="">全部状态</option>
        <option value="draft">草稿</option>
        <option value="published">已发布</option>
        <option v-if="kind === 'events'" value="disabled">停用</option>
        <option v-else value="withdrawn">撤回</option></select
      ><button class="button button-outline">查询</button>
    </form>
    <section v-if="kind === 'popups'" class="admin-empty">
      <h2>当前弹窗</h2>
      <p>{{ currentPopup?.title ?? '暂无生效弹窗' }}</p>
      <label
        >查看记录
        <select v-model="popupFilter">
          <option value="all">全部</option>
          <option value="active">当前有效</option>
          <option value="scheduled">待生效</option>
          <option value="retired">历史弹窗</option>
          <option value="disabled">已停用</option>
        </select></label
      >
    </section>
    <div class="admin-table-wrap">
      <table class="admin-table publication-management-table">
        <thead>
          <tr>
            <th>标题</th>
            <th>状态</th>
            <th>发布时间/创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in displayedRows" :key="row.id">
            <td>{{ row.title }}</td>
            <td>
              {{
                'state' in row
                  ? popupLabels[row.state]
                  : statusLabels[row.status]
              }}
            </td>
            <td>
              {{
                beijing('publishedAt' in row ? row.publishedAt : row.createdAt)
              }}
            </td>
            <td>
              <button
                v-if="kind === 'events'"
                class="text-link"
                :disabled="busy || managerBusy"
                @click="edit(row, 'registrations')"
              >
                报名审核与名单
              </button>
              <button
                v-if="kind === 'events'"
                class="text-link"
                :disabled="busy || managerBusy"
                @click="edit(row, 'checkin')"
              >
                签到管理
              </button>
              <button
                class="text-link"
                :disabled="busy || managerBusy"
                @click="edit(row)"
              >
                {{ kind === 'popups' ? '预览/新版本' : '编辑' }}</button
              ><button
                v-if="kind === 'popups' && 'enabled' in row"
                class="text-link"
                @click="toggle(row)"
              >
                {{
                  row.state === 'retired'
                    ? '重新启用'
                    : row.enabled
                      ? '停用'
                      : '启用'
                }}</button
              ><RouterLink
                v-else
                :to="`${kind === 'events' ? '/activities' : '/news'}/${row.id}`"
                >前台详情</RouterLink
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!rows.length">暂无内容。</p>
    <div v-if="kind !== 'popups'" class="publication-tools">
      <button :disabled="page === 1" @click="turn(-1)">上一页</button
      ><span>{{ page }} / 共{{ total }}条</span
      ><button :disabled="page * 20 >= total" @click="turn(1)">下一页</button>
    </div>
    <nav
      v-if="kind === 'events' && selected"
      class="event-workspace-tabs"
      aria-label="活动管理功能"
    >
      <button
        :class="{ active: workspaceTab === 'settings' }"
        :disabled="busy || managerBusy"
        @click="workspaceTab = 'settings'"
      >
        活动设置
      </button>
      <button
        :class="{ active: workspaceTab === 'registrations' }"
        :disabled="busy || managerBusy"
        @click="workspaceTab = 'registrations'"
      >
        报名审核与名单
      </button>
      <button
        :class="{ active: workspaceTab === 'checkin' }"
        :disabled="busy || managerBusy"
        @click="workspaceTab = 'checkin'"
      >
        签到管理
      </button>
    </nav>
    <form
      v-if="
        (selected || canSave) &&
        (kind !== 'events' || workspaceTab === 'settings')
      "
      class="member-form stage3-editor"
      @submit.prevent="save"
      @invalid.capture="invalidField"
    >
      <h2>{{ selected ? '编辑 / 发布新版本' : '新建内容' }}</h2>
      <label>标题<input v-model="form.title" maxlength="120" required /></label
      ><label>简介<textarea v-model="form.summary" maxlength="500" /></label
      ><label
        >封面图片（PNG/JPEG/WebP，原文件3MB以内，自动压缩至50KB以内）<input
          ref="coverInput"
          type="file"
          :disabled="busy || !canSave"
          accept="image/png,image/jpeg,image/webp"
          @change="picture" /></label
      ><img
        v-if="kind === 'popups' ? form.image : form.cover"
        :src="imageSource(kind === 'popups' ? form.image : form.cover, true)"
        class="editor-cover"
        alt="封面预览"
      />
      <p v-if="coverMessage" role="status">{{ coverMessage }}</p>
      <template v-if="kind !== 'popups'"
        ><ContentEditor
          :key="kind + selected"
          v-model="form.content"
          :disabled="busy || !canSave"
          @busy="setEditorBusy"
        /><label
          >状态<select v-model="form.status">
            <option value="draft">草稿</option>
            <option value="published">发布</option>
            <option v-if="kind === 'events'" value="disabled">停用</option>
            <option v-else value="withdrawn">撤回</option>
          </select></label
        ></template
      >
      <template v-if="kind === 'events'"
        ><EventManagerPicker
          v-model="managerIds"
          :event-id="selected || undefined"
          :readonly="!auth.can('events.edit')"
          @busy="managerBusy = $event" />
        <label>地点<input v-model="form.location" maxlength="200" /></label
        ><label
          >活动开始（北京时间）<input
            v-model="form.startsAt"
            type="datetime-local"
            required /></label
        ><label
          >活动结束（北京时间）<input
            v-model="form.endsAt"
            type="datetime-local"
            required /></label
        ><label class="checkbox-line"
          ><input
            v-model="form.registrationEnabled"
            type="checkbox"
          />开启活动报名</label
        ><template v-if="form.registrationEnabled"
          ><label
            >报名开始（可选）<input
              v-model="form.registrationStartsAt"
              type="datetime-local" /></label
          ><label
            >报名截止<input
              v-model="form.registrationDeadline"
              type="datetime-local"
              required /></label
          ><label
            >人数上限（留空不限）<input
              v-model="form.capacity"
              type="number"
              min="1" /></label
          ><label class="checkbox-line"
            ><input
              v-model="form.allowCancellation"
              type="checkbox"
            />允许截止前取消报名</label
          ><label class="checkbox-line"
            ><input
              v-model="form.approvalRequired"
              type="checkbox"
            />报名需审核（待审核占名额）</label
          ><label class="checkbox-line"
            ><input
              v-model="form.notesEnabled"
              type="checkbox"
            />允许备注</label
          ><label v-if="form.notesEnabled" class="checkbox-line"
            ><input
              v-model="form.notesRequired"
              type="checkbox"
            />备注必填</label
          ></template
        ><label class="checkbox-line"
          ><input
            v-model="form.checkinEnabled"
            type="checkbox"
          />启用签到</label
        ><label v-if="form.checkinEnabled"
          >签到码默认有效期（分钟）<input
            v-model.number="checkinMinutes"
            type="number"
            min="0.5"
            max="1440"
            step="0.5"
            required /></label
      ></template>
      <template v-if="kind === 'articles'"
        ><label
          >分类<input v-model="form.category" maxlength="40" required /></label
        ><label class="checkbox-line"
          ><input v-model="form.pinned" type="checkbox" />置顶</label
        ></template
      >
      <template v-if="kind === 'popups'"
        ><label
          >关联类型<select v-model="form.targetType">
            <option value="event">活动</option>
            <option value="article">新闻公告</option>
          </select></label
        ><label>关联内容ID<input v-model="form.targetId" required /></label
        ><label
          >按钮文字<input
            v-model="form.buttonText"
            maxlength="30"
            required /></label
        ><label
          >生效时间<input
            v-model="form.startsAt"
            type="datetime-local"
            required /></label
        ><label
          >失效时间<input
            v-model="form.expiresAt"
            type="datetime-local"
            required /></label
        ><label
          >优先级（越大越优先）<input
            v-model="form.priority"
            type="number"
            min="0"
            max="1000"
        /></label>
        <section class="admin-empty">
          <h3>{{ form.title }}</h3>
          <p>{{ form.summary }}</p>
          <span>{{ form.buttonText }}</span>
        </section></template
      >
      <template
        v-if="kind !== 'popups' && auth.can('announcements.popup.manage')"
        ><label class="checkbox-line"
          ><input
            v-model="announce"
            type="checkbox"
          />发布时进入官网弹窗展示（内容须已发布）</label
        >
        <div v-if="announce">
          <label
            >弹窗标题<input
              v-model="notice.title"
              :placeholder="form.title" /></label
          ><label
            >弹窗简介<textarea
              v-model="notice.summary"
              :placeholder="form.summary"
            /></label
          ><label
            >弹窗图片HTTPS地址（空白沿用封面）<input
              v-model="notice.image" /></label
          ><label>按钮文字<input v-model="notice.buttonText" required /></label
          ><label
            >生效时间<input
              v-model="notice.startsAt"
              type="datetime-local"
              required /></label
          ><label
            >失效时间<input
              v-model="notice.expiresAt"
              type="datetime-local"
              required
          /></label></div
      ></template>
      <div class="publication-tools">
        <button
          v-if="kind === 'articles' && selected && auth.can('articles.publish')"
          type="button"
          class="button button-outline"
          @click="publishArticle(form.status !== 'published')"
        >
          {{ form.status === 'published' ? '撤回' : '发布' }}
        </button>

        <button
          :disabled="busy || managerBusy || !canSave"
          class="button button-primary"
        >
          {{ kind === 'popups' ? '发布新弹窗版本' : '保存' }}</button
        ><button
          v-if="
            selected &&
            kind !== 'popups' &&
            auth.can(kind === 'events' ? 'events.delete' : 'articles.delete')
          "
          type="button"
          class="button button-outline"
          @click="remove"
        >
          删除
        </button>
      </div>
      <p v-if="busy" role="status" aria-live="polite">正在处理，请稍候…</p>
      <p
        v-if="
          kind !== 'popups' &&
          selected &&
          auth.can('announcements.popup.manage')
        "
      >
        已保存内容ID：{{ selected }}。发布后可到弹窗管理关联此内容。
      </p>
    </form>
    <EventOperations
      v-if="kind === 'events' && selected && workspaceTab !== 'settings'"
      :event-id="selected"
      :tab="workspaceTab"
      @settings="updateCheckinSettings"
    />
  </div>
</template>
