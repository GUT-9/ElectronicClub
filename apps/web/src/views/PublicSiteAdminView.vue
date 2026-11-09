<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { budgetEstimate } from '@electronic-club/shared/public-site'
import { request } from '../member-api'
import PageIntro from '../components/PageIntro.vue'
type State = { configured: boolean; mode: string; origin: string; dirty: boolean; generatedAt: string | null; garbage: number; pendingAssets: number; pointPrice: number | null }
const status = ref<State | null>(null), busy = ref(false), message = ref('')
const price = ref(''), days = ref(20), minutes = ref(20), reserve = ref(300)
const estimate = computed(() => {
  try { return budgetEstimate(price.value === '' ? null : Number(price.value), days.value, minutes.value, reserve.value) }
  catch { return null }
})
async function load() {
  status.value = await request<State>('/public-site/status')
  if (status.value.pointPrice && !price.value) price.value = String(status.value.pointPrice)
}
async function publish() {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const result = await request<{ state: string }>('/public-site/rebuild', 'POST', {})
    message.value = result.state === 'ready' ? '公开内容已同步。' : result.state === 'pending' ? '已有同步任务进行中，请稍后检查状态。' : '同步未完成，数据库中的内容仍然保留，请检查七牛配置后重试。'
    await load()
  } catch (error) { message.value = (error as Error).message }
  finally { busy.value = false }
}
onMounted(() => load().catch((error) => { message.value = error.message }))
</script>
<template>
  <PageIntro title="公开发布与预算" english="PUBLIC DELIVERY" description="查看公开页面的同步状态，按实际计费单价核算月度资源预算。" />
  <section class="ui-panel" v-if="status">
    <h2>公开发布</h2>
    <p>当前模式：{{ status.mode === 'qiniu' ? '七牛公开副本' : '数据库读取' }}</p>
    <p>存储配置：{{ status.configured ? '已配置' : '未就绪' }} · {{ status.dirty ? '有内容待同步' : '已同步' }}</p>
    <p>最近同步：{{ status.generatedAt ? new Date(status.generatedAt).toLocaleString() : '尚未生成' }}</p>
    <p v-if="status.garbage">待清理图片对象：{{ status.garbage }}，再次同步时重试清理。</p>
    <p v-if="status.pendingAssets">待同步图片：{{ status.pendingAssets }}，再次同步会继续已保存的复制进度。</p>
    <button class="button button-primary" :disabled="busy || !status.configured" @click="publish">{{ busy ? '正在同步…' : '同步公开内容' }}</button>
    <button class="plain-button" :disabled="busy" @click="load">刷新状态</button>
  </section>
  <p v-if="message" class="ui-message" role="status">{{ message }}</p>
  <section class="ui-panel budget-form">
    <h2>每月 1500 点目标</h2>
    <p>公开副本读取不访问 PostgreSQL。登录、成员互动、报名签到、后台管理、SQL 编辑器查询及云端任务仍可能触发计费。</p>
    <label>共享数据库单价（资源点/核秒）<input v-model="price" type="number" min="0" step="any" placeholder="按当前套餐计量说明填写，不知道请留空" /></label>
    <label>每月动态使用天数<input v-model.number="days" type="number" min="0" max="31" /></label>
    <label>每天预计覆盖的动态使用分钟数<input v-model.number="minutes" type="number" min="0" max="1440" /></label>
    <label>函数、存储、流量等预留资源点<input v-model.number="reserve" type="number" min="0" max="1499" /></label>
    <template v-if="estimate">
      <p>预计活跃计费段：{{ estimate.windows }} 段/月。每段按 150 核秒估算。</p>
      <p v-if="estimate.estimated === null">单价尚未填写，暂不能判定是否达到 1500 点目标。</p>
      <template v-else><p><strong>条件性预计：{{ estimate.estimated.toFixed(1) }} 点/月</strong> · {{ estimate.withinTarget ? '在目标预算内' : '超出目标预算' }}</p>
        <p>按当前预留和单价，每月最多 {{ estimate.maxWindows }} 个活跃计费段。</p></template>
    </template>
    <p v-else class="ui-message">请检查输入范围。</p>
    <p>计算式：活跃时段 × 150 核秒 × 单价 + 其他资源预留。分散操作请把各个 5 分钟段累计，不能只填写 SQL 的执行毫秒数。此处是预算测算，不是腾讯云账单或自动扣费上限。</p>
  </section>
</template>
<style scoped>
.ui-panel { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 24px; }
.ui-panel h2 { font-size: 24px; margin-bottom: 16px; }
.budget-form { margin-top: 24px; }
.budget-form label { display: grid; gap: 8px; margin: 18px 0; max-width: 560px; }
.budget-form input { padding: 12px; border: 1px solid var(--line); border-radius: 4px; }
.ui-panel p { line-height: 1.9; }
</style>
