<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import type { LoginRecord, Page } from '@electronic-club/shared'
import MemberStats from '../components/MemberStats.vue'
import { request } from '../member-api'
import { beijing } from '../stage3'
const data = ref<Page<LoginRecord>>(),
  busy = ref(false),
  error = ref(''),
  page = ref(1)
const filter = reactive({ search: '', outcome: 'all', from: '', to: '' })
const outcomes: Record<string, string> = {
  success: '登录成功',
  failure: '登录失败',
  blocked: '已拦截',
}
const reasons: Record<string, string> = {
  INVALID_CREDENTIALS: '凭据错误或账号不可用',
  RATE_LIMITED: '登录尝试过于频繁',
  ACTIVATION_EXPIRED: '初始凭据已过期',
}
let generation = 0
async function load() {
  const seq = ++generation
  busy.value = true
  error.value = ''
  try {
    const q = new URLSearchParams({
      page: String(page.value),
      pageSize: '20',
      search: filter.search,
      outcome: filter.outcome,
    })
    if (filter.from)
      q.set('from', new Date(filter.from + 'T00:00:00+08:00').toISOString())
    if (filter.to)
      q.set(
        'to',
        new Date(
          Date.parse(filter.to + 'T00:00:00+08:00') + 86400000,
        ).toISOString(),
      )
    const result = await request<Page<LoginRecord>>('/login-history?' + q)
    if (seq === generation) data.value = result
  } catch (e) {
    if (seq === generation) error.value = (e as Error).message
  } finally {
    if (seq === generation) busy.value = false
  }
}
function search() {
  page.value = 1
  void load()
}
function reset() {
  Object.assign(filter, { search: '', outcome: 'all', from: '', to: '' })
  search()
}
function turn(n: number) {
  page.value += n
  void load()
}
onMounted(load)
</script>
<template>
  <section class="login-history">
    <header class="login-history-heading">
      <div>
        <p class="eyebrow">ACCOUNT ACTIVITY</p>
        <h1>成员登录记录</h1>
        <p>
          查看登录时间、成员档案、来源 IP 及设备信息，及时了解账号使用情况。
        </p>
      </div>
      <button class="button button-outline" :disabled="busy" @click="load">
        刷新记录
      </button>
    </header>
    <MemberStats />
    <form class="login-history-filter" @submit.prevent="search">
      <label class="history-search"
        >查找成员或 IP<input
          v-model="filter.search"
          placeholder="姓名、学号或 IP"
          maxlength="80" /></label
      ><label
        >登录结果<select v-model="filter.outcome">
          <option value="all">全部结果</option>
          <option value="success">登录成功</option>
          <option value="failure">登录失败</option>
          <option value="blocked">已拦截</option>
        </select></label
      ><label
        >开始日期<input
          v-model="filter.from"
          type="date"
          :max="filter.to || undefined" /></label
      ><label
        >结束日期<input
          v-model="filter.to"
          type="date"
          :min="filter.from || undefined" /></label
      ><button class="button button-primary" :disabled="busy">查询</button
      ><button
        type="button"
        class="plain-button"
        :disabled="busy"
        @click="reset"
      >
        重置
      </button>
    </form>
    <p class="login-history-note">
      时间按北京时间显示。失败记录关联的是被尝试的账号，不代表该成员本人操作；设备与系统由浏览器标识推断，Windows
      10/11 等部分版本无法精确区分。旧记录未采集的 IP、设备会标注为未记录。
    </p>
    <p v-if="error" class="operation-message" role="alert">
      {{ error }}<button class="plain-button" @click="load">重新加载</button>
    </p>
    <p v-if="busy" role="status">正在读取登录记录…</p>
    <div v-else-if="data && !error" class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>登录时间</th>
            <th>成员 / 学号</th>
            <th>结果</th>
            <th>登录 IP</th>
            <th>设备 / 系统</th>
            <th>浏览器</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in data.items" :key="row.id">
            <td class="history-date">{{ beijing(row.createdAt) }}</td>
            <td>
              <strong>{{ row.name || '未关联成员' }}</strong
              ><small>{{
                row.studentId ||
                (row.anonymized ? '身份资料已匿名化' : '未记录账号')
              }}</small
              ><small
                v-if="row.memberUid && row.outcome !== 'success'"
                class="history-muted"
                >尝试账号，身份未验证</small
              >
            </td>
            <td>
              <span class="history-outcome" :class="row.outcome">{{
                outcomes[row.outcome]
              }}</span
              ><small v-if="row.reason">{{
                reasons[row.reason] || row.reason
              }}</small>
            </td>
            <td>
              <code>{{
                row.ip ||
                (row.anonymized
                  ? '已匿名化'
                  : row.legacy
                    ? '未记录'
                    : '网关未提供')
              }}</code
              ><small v-if="row.ipSource === 'trusted-header'"
                >受信任网关转发</small
              >
            </td>
            <td>
              {{ row.device || '未记录'
              }}<small>{{ row.os || '未记录' }}</small>
            </td>
            <td>
              {{ row.browser || '未记录' }}
              <details v-if="row.userAgent" class="history-agent">
                <summary>原始浏览器标识</summary>
                <p>{{ row.userAgent }}</p>
              </details>
            </td>
          </tr>
          <tr v-if="!data.items.length">
            <td colspan="6" class="history-empty">
              没有符合条件的登录记录。尝试调整筛选条件。
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <nav
      v-if="data && !error"
      class="history-pagination"
      aria-label="登录记录分页"
    >
      <span>共 {{ data.total }} 条 · 第 {{ page }} 页 · 每页20条</span
      ><button
        class="plain-button"
        :disabled="busy || page <= 1"
        @click="turn(-1)"
      >
        上一页</button
      ><button
        class="plain-button"
        :disabled="busy || page * 20 >= data.total"
        @click="turn(1)"
      >
        下一页
      </button>
    </nav>
  </section>
</template>
<style scoped>
.login-history-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.login-history-heading > .button {
  border: 1px solid var(--line);
  background: white;
  color: var(--blue);
}
.login-history-heading h1 {
  margin: 10px 0 12px;
}
.login-history-heading p:not(.eyebrow) {
  font-size: 14px;
}
.login-history-filter {
  display: flex;
  gap: 14px;
  align-items: end;
  flex-wrap: wrap;
  padding: 20px;
  background: white;
  border: 1px solid var(--line);
  border-radius: 10px;
  margin: 28px 0 16px;
}
.login-history-filter label {
  display: grid;
  gap: 7px;
  font-size: 12px;
  color: var(--muted);
}
.login-history-filter input,
.login-history-filter select {
  padding: 10px 12px;
  font: inherit;
  font-size: 14px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: white;
  min-width: 0;
  width: 100%;
}
.history-search {
  flex: 1;
  min-width: 180px;
}
.login-history-filter .button {
  border: 1px solid transparent;
  min-height: 43px;
  padding: 9px 18px;
  border-radius: 6px;
}
.login-history-note {
  font-size: 12px;
  line-height: 1.9;
  color: var(--muted);
  max-width: 1000px;
  margin-bottom: 22px;
}
.admin-table {
  min-width: 960px;
  width: 100%;
}
.admin-table td {
  vertical-align: top !important;
  padding: 18px 14px;
  font-size: 13px;
}
.admin-table strong {
  font-weight: 500;
}
.admin-table small {
  display: block;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.7;
  margin-top: 5px;
  max-width: 180px;
}
.history-date {
  white-space: nowrap;
}
.history-agent {
  font-size: 11px;
  color: var(--muted);
  margin-top: 8px;
  max-width: 230px;
}
.history-agent summary {
  cursor: pointer;
}
.history-agent p {
  font-family: var(--mono);
  font-size: 10px;
  overflow-wrap: anywhere;
  line-height: 1.8;
  margin-top: 8px;
}
.history-outcome {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 4px;
  white-space: nowrap;
  background: #eef3fa;
  color: #48627f;
}
.history-outcome.success {
  background: #eaf6f0;
  color: #24734c;
}
.history-outcome.failure {
  background: #fff0ee;
  color: #a64638;
}
.history-outcome.blocked {
  background: #fff5df;
  color: #8a671b;
}
.history-empty {
  text-align: center;
  padding: 36px !important;
  color: var(--muted);
}
.history-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  margin-top: 22px;
  font-size: 12px;
  color: var(--muted);
}
.history-pagination > span {
  margin-right: auto;
}
.admin-table code {
  font-size: 12px;
  overflow-wrap: anywhere;
  max-width: 180px;
  display: block;
}
@media (max-width: 700px) {
  .login-history-heading {
    align-items: start;
    flex-direction: column;
  }
  .login-history-filter {
    padding: 16px;
    gap: 12px;
  }
  .login-history-filter label {
    flex: 1 1 130px;
  }
  .history-search {
    flex-basis: 100% !important;
  }
  .history-pagination {
    flex-wrap: wrap;
  }
  .history-pagination > span {
    width: 100%;
  }
}
</style>
