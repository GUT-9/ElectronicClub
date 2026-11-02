<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ImportJob } from '@electronic-club/shared'
import { request, download } from '../member-api'
const job = ref<ImportJob | null>(null),
  file = ref<File | null>(null),
  busy = ref(false),
  message = ref(''),
  page = ref(1),
  jobId = ref('')
const visible = computed(
  () => job.value?.rows.slice((page.value - 1) * 50, page.value * 50) ?? [],
)
function choose(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
  job.value = null
  message.value = ''
}
async function action(fn: () => Promise<void>) {
  busy.value = true
  message.value = ''
  try {
    await fn()
  } catch (e) {
    message.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
async function preview() {
  await action(async () => {
    if (!file.value) throw new Error('请选择.xlsx文件')
    if (
      !file.value.name.toLowerCase().endsWith('.xlsx') ||
      file.value.size > 2_000_000
    )
      throw new Error('仅支持2MB以内的.xlsx文件')
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1]!)
      reader.onerror = () => reject(new Error('文件读取失败'))
      reader.readAsDataURL(file.value!)
    })
    job.value = await request<ImportJob>('/imports/preview', 'POST', {
      file: content,
    })
    jobId.value = job.value.id
    page.value = 1
  })
}
async function resume() {
  await action(async () => {
    job.value = await request<ImportJob>(`/imports/${jobId.value}`)
    page.value = 1
  })
}
async function process() {
  if (
    !job.value ||
    !window.confirm('确认创建所有通过校验的成员？错误行将跳过，可导出修正。')
  )
    return
  await action(async () => {
    while (job.value && job.value.status !== 'completed') {
      const offset = job.value.offset
      job.value = await request<ImportJob>(
        `/imports/${job.value.id}/process`,
        'POST',
        { offset },
      )
      if (job.value.offset === offset && job.value.status !== 'completed')
        throw new Error('任务进度未变化，请重新读取任务')
    }
  })
}
async function getFile(path: string, name: string) {
  await action(() => download(path, name))
}
</script>
<template>
  <p class="eyebrow">BATCH IMPORT</p>
  <h1>Excel 批量导入</h1>
  <p>
    学号必须为文本，保留前导零。支持学号、姓名、性别、学院、专业、班级、年级；每文件最多1000行，分批20行创建。
  </p>
  <div class="action-row">
    <button
      class="plain-button"
      :disabled="busy"
      @click="getFile('/imports/template', 'members-template.xlsx')"
    >
      下载 XLSX 模板</button
    ><label class="file-picker"
      >选择 .xlsx<input
        type="file"
        accept=".xlsx"
        :disabled="busy"
        @change="choose" /></label
    ><button
      class="button button-primary"
      :disabled="busy || !file"
      @click="preview"
    >
      上传并预览
    </button>
  </div>
  <form class="filter-form" @submit.prevent="resume">
    <label
      >已有任务 ID（可继续中断的导入）<input
        v-model="jobId"
        maxlength="64"
        required /></label
    ><button class="plain-button" :disabled="busy">读取任务</button>
  </form>
  <p v-if="message" role="alert" class="form-error">{{ message }}</p>
  <p v-if="busy" role="status">
    正在处理，请勿关闭页面；中断后可使用任务 ID 继续。
  </p>
  <section v-if="job" class="admin-empty">
    <h2>导入预览与结果</h2>
    <p class="break-text">任务 ID：{{ job.id }}</p>
    <p>
      总行数 {{ job.rows.length }} · 已处理 {{ job.offset }} · 创建
      {{ job.created }} · 跳过 {{ job.skipped }} · {{ job.status }}
    </p>
    <p>
      预览错误
      {{
        job.rows.filter((row) => row.error).length
      }}
      行。首次创建昵称与姓名相同，默认普通成员，首次登录必须修改密码；初始激活凭据7天后过期。
    </p>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>行</th>
            <th>学号</th>
            <th>姓名</th>
            <th>结果 / 错误</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visible" :key="row.line">
            <td>{{ row.line }}</td>
            <td>{{ row.member?.studentId ?? '无效' }}</td>
            <td>{{ row.member?.name }}</td>
            <td>{{ row.error ?? (row.uid ? '已创建' : '待创建') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="pagination">
      <button :disabled="page === 1" @click="page--">上一页</button
      ><span>{{ page }}</span
      ><button :disabled="page * 50 >= job.rows.length" @click="page++">
        下一页
      </button>
    </div>
    <div class="action-row">
      <button
        class="button button-primary"
        :disabled="busy || job.status === 'completed'"
        @click="process"
      >
        {{ job.status === 'preview' ? '确认并批量创建' : '继续处理' }}</button
      ><button
        class="plain-button"
        :disabled="busy"
        @click="getFile(`/imports/${job.id}/errors.xlsx`, 'import-errors.xlsx')"
      >
        导出错误行 XLSX
      </button>
    </div>
  </section>
</template>
