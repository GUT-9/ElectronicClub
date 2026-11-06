<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import type { ClubResource, Page } from '@electronic-club/shared'
import { RESOURCE_ACCEPT } from '@electronic-club/shared'
import { request } from '../member-api'
import { beijing } from '../stage3'
const rows = ref<ClubResource[]>([]),
  page = ref(1),
  total = ref(0),
  busy = ref(false),
  error = ref(''),
  message = ref(''),
  selected = ref(''),
  file = ref<File>(),
  fileInput = ref<HTMLInputElement>(),
  progress = ref(0)
const config = ref<{
  configured: boolean
  bucket: string
  domain: string
  maxBytes: number
  budget: number
  reservedBytes: number
}>()
const form = reactive({
  title: '',
  description: '',
  category: '其他',
  status: 'draft',
})
const labels: Record<string, string> = {
  uploading: '待上传/校验',
  draft: '草稿',
  published: '已发布',
  deleting: '待清理文件',
  deleted: '已删除',
}
const mb = (n: number) => (n / 1048576).toFixed(1) + ' MB'
async function load() {
  const [list, settings] = await Promise.all([
    request<Page<ClubResource>>('/resources?admin=true&page=' + page.value),
    request<typeof config.value>('/resources/config'),
  ])
  rows.value = list.items
  total.value = list.total
  config.value = settings
}
async function run(fn: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    try {
      await load()
    } catch (e) {
      error.value = error.value || '列表刷新失败：' + (e as Error).message
    }
    busy.value = false
  }
}
function reset() {
  if (busy.value) return
  selected.value = ''
  file.value = undefined
  if (fileInput.value) fileInput.value.value = ''
  Object.assign(form, {
    title: '',
    description: '',
    category: '其他',
    status: 'draft',
  })
}
function choose(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0]
  if (file.value && !form.title)
    form.title = file.value.name.replace(/\.[^.]+$/, '').slice(0, 120)
}
function edit(row: ClubResource) {
  if (busy.value) return
  selected.value = row.id
  Object.assign(form, {
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
  })
  document
    .getElementById('resource-editor')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function directUpload(url: string, data: FormData) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.timeout = 600000
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        progress.value = Math.min(99, Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new Error(
              `七牛上传失败（HTTP ${xhr.status}），请检查上传域名、密钥权限和空间跨域配置`,
            ),
          )
    xhr.onerror = () =>
      reject(new Error('上传连接失败，请检查网络及七牛空间跨域设置'))
    xhr.ontimeout = () => reject(new Error('上传超时，请检查网络后重试'))
    xhr.send(data)
  })
}
async function save() {
  await run(async () => {
    if (selected.value) {
      await request(`/resources/${selected.value}/update`, 'POST', { ...form })
      message.value = '资料信息已保存'
      return
    }
    if (!file.value) throw new Error('请选择资料文件')
    if (!config.value?.configured) throw new Error('七牛存储尚未配置')
    if (file.value.size > config.value.maxBytes)
      throw new Error('文件超过当前单文件上限')
    const ticket = await request<{
      id: string
      uploadUrl: string
      token: string
      key: string
    }>('/resources/uploads', 'POST', {
      title: form.title,
      description: form.description,
      category: form.category,
      originalName: file.value.name,
      size: file.value.size,
    })
    const upload = new FormData()
    upload.append('key', ticket.key)
    upload.append('token', ticket.token)
    upload.append('file', file.value)
    progress.value = 0
    await directUpload(ticket.uploadUrl, upload)
    progress.value = 100
    await request(`/resources/${ticket.id}/complete`, 'POST', {})
    selected.value = ticket.id
    form.status = 'draft'
    message.value =
      '文件已上传并通过格式校验，当前为草稿。选择“发布”并保存后公开显示。'
  })
}
async function complete(row: ClubResource) {
  await run(async () => {
    await request(`/resources/${row.id}/complete`, 'POST', {})
    message.value = '文件已校验，现可编辑并发布。'
  })
}
async function remove(row: ClubResource) {
  if (
    !confirm(
      '删除这份资料及对应七牛文件？已公开文件的 CDN 缓存可能短时仍可访问。',
    )
  )
    return
  await run(async () => {
    const result = await request<{ pending?: boolean; deleteAfter?: string }>(
      `/resources/${row.id}/delete`,
      'POST',
      {},
    )
    message.value = result.pending
      ? `资料已下架。为防止未过期上传凭证重新写入文件，请在 ${beijing(result.deleteAfter)} 后重试清理，或运行私有暂存清理。`
      : '资料及文件已删除。'
    if (selected.value === row.id) {
      selected.value = ''
      file.value = undefined
      Object.assign(form, {
        title: '',
        description: '',
        category: '其他',
        status: 'draft',
      })
    }
  })
}
async function turn(n: number) {
  page.value += n
  await run(async () => {})
}
onMounted(() => {
  void run(async () => {})
})
</script>
<template>
  <section>
    <header class="resource-admin-header">
      <div>
        <p class="eyebrow">CLUB RESOURCE LIBRARY</p>
        <h1>社团资料管理</h1>
        <p>管理员上传、校验和发布，游客可从公开资料库下载。</p>
      </div>
      <RouterLink to="/resources" class="text-link"
        >查看公开资料库 ↗</RouterLink
      >
    </header>
    <p v-if="error" class="operation-message" role="alert">{{ error }}</p>
    <p v-if="message" class="operation-message" role="status">{{ message }}</p>
    <div class="resource-storage">
      <strong>{{
        config?.configured ? '七牛存储已配置' : '七牛存储待配置'
      }}</strong
      ><template v-if="config?.configured"
        ><span>空间 {{ config.bucket }}</span
        ><span
          >应用预算已占用/预留 {{ mb(config.reservedBytes) }} /
          {{ mb(config.budget) }}</span
        ><span>单文件上限 {{ mb(config.maxBytes) }}</span></template
      >
      <p v-else>
        请按部署文档将 AccessKey、SecretKey、空间和 HTTPS
        下载域名配置在云函数环境变量中，不要填入前端。
      </p>
    </div>
    <div class="publication-tools">
      <button class="button button-primary" :disabled="busy" @click="reset">
        上传新资料</button
      ><button
        class="plain-button"
        :disabled="busy"
        @click="run(async () => {})"
      >
        刷新
      </button>
    </div>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>资料</th>
            <th>分类</th>
            <th>大小</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>
              <strong>{{ row.title }}</strong
              ><small>{{ row.originalName }}</small>
            </td>
            <td>{{ row.category }}</td>
            <td>{{ mb(row.size) }}</td>
            <td>{{ labels[row.status] }}</td>
            <td>
              <button
                v-if="['draft', 'published'].includes(row.status)"
                class="plain-button"
                :disabled="busy"
                @click="edit(row)"
              >
                编辑</button
              ><button
                v-if="row.status === 'uploading'"
                class="plain-button"
                :disabled="busy"
                @click="complete(row)"
              >
                校验上传</button
              ><button
                v-if="row.status !== 'deleted'"
                class="plain-button danger"
                :disabled="busy"
                @click="remove(row)"
              >
                {{ row.status === 'deleting' ? '重试清理' : '删除' }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="5">
              {{ busy ? '正在加载…' : '还没有资料，选择文件开始上传。' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <nav v-if="total > 20" class="pagination">
      <button :disabled="busy || page <= 1" @click="turn(-1)">上一页</button
      ><span>第{{ page }}页 · 共{{ total }}条</span
      ><button :disabled="busy || page * 20 >= total" @click="turn(1)">
        下一页
      </button>
    </nav>
    <form
      id="resource-editor"
      class="member-form resource-editor"
      @submit.prevent="save"
    >
      <h2>{{ selected ? '编辑资料' : '上传资料' }}</h2>
      <label
        >标题<input
          v-model="form.title"
          maxlength="120"
          required
          :disabled="busy" /></label
      ><label
        >说明<textarea
          v-model="form.description"
          maxlength="2000"
          rows="3"
          :disabled="busy"
        /></label
      ><label
        >分类<input
          v-model="form.category"
          maxlength="40"
          required
          list="admin-resource-categories"
          :disabled="busy"
        /><datalist id="admin-resource-categories">
          <option>基础教程</option>
          <option>竞赛资料</option>
          <option>项目文档</option>
          <option>社团制度</option>
          <option>其他</option>
        </datalist></label
      ><label v-if="!selected"
        >资料文件<input
          ref="fileInput"
          type="file"
          :accept="RESOURCE_ACCEPT"
          required
          :disabled="busy || !config?.configured"
          @change="choose"
      /></label>
      <p>
        支持
        PDF、Office、ZIP/7z、TXT/CSV。公开空间中的草稿文件也不具备保密性，请勿上传个人信息或内部敏感资料。
      </p>
      <label v-if="selected"
        >状态<select v-model="form.status" :disabled="busy">
          <option value="draft">草稿 / 下架</option>
          <option value="published">发布到公开资料库</option>
        </select></label
      >
      <div
        v-if="busy && file && !selected"
        class="resource-upload-progress"
        role="status"
      >
        <progress :value="progress" max="100" /><span>{{
          progress < 100 ? `上传中 ${progress}%` : '上传完成，正在校验…'
        }}</span>
      </div>
      <button
        class="button button-primary"
        :disabled="busy || !config?.configured"
      >
        {{ busy ? '正在处理…' : selected ? '保存资料信息' : '上传并校验' }}
      </button>
    </form>
  </section>
</template>
<style scoped>
.resource-admin-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}
.resource-admin-header p:not(.eyebrow) {
  font-size: 13px;
  margin-top: 12px;
}
.resource-storage {
  display: flex;
  gap: 12px 24px;
  flex-wrap: wrap;
  align-items: center;
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
  margin: 24px 0;
  font-size: 12px;
  color: var(--muted);
}
.resource-storage strong {
  color: var(--ink);
  font-size: 14px;
}
.resource-storage p {
  line-height: 1.8;
}
.admin-table {
  width: 100%;
  min-width: 700px;
}
.admin-table small {
  display: block;
  font-size: 11px;
  color: var(--muted);
  margin-top: 6px;
}
.admin-table td {
  padding: 18px 12px;
}
.resource-editor {
  max-width: 760px;
  padding: 26px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: white;
  margin-top: 32px;
}
.resource-editor h2 {
  font-size: 22px;
  margin-bottom: 10px;
}
.resource-editor > p {
  font-size: 12px;
  line-height: 1.9;
}
.resource-upload-progress {
  display: flex;
  gap: 16px;
  align-items: center;
  font-size: 12px;
  color: var(--muted);
}
.resource-upload-progress progress {
  width: 60%;
}
.resource-editor > .button,
.publication-tools > .button {
  border: 1px solid transparent;
  border-radius: 6px;
}
@media (max-width: 600px) {
  .resource-admin-header {
    align-items: start;
    flex-direction: column;
  }
  .resource-editor {
    padding: 20px;
  }
  .resource-storage {
    padding: 16px;
  }
  .resource-upload-progress {
    flex-wrap: wrap;
  }
}
</style>
