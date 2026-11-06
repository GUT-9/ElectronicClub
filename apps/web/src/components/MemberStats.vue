<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { MemberStats } from '@electronic-club/shared'
import { request } from '../member-api'
const data = ref<MemberStats>(),
  error = ref(''),
  busy = ref(false)
async function load() {
  busy.value = true
  error.value = ''
  try {
    data.value = await request<MemberStats>('/members/stats')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>
<template>
  <section class="member-stats">
    <header>
      <div>
        <h2>成员使用情况</h2>
        <p>按当前正常账号去重统计，不包含已禁用、已删除或匿名化账号。</p>
      </div>
      <button class="plain-button" :disabled="busy" @click="load">
        {{ busy ? '更新中…' : '刷新统计' }}
      </button>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-else class="member-stats-grid">
      <div>
        <span>正常账号</span><strong>{{ data?.activeMembers ?? '—' }}</strong>
      </div>
      <div>
        <span>成功登录过</span
        ><strong>{{ data?.loggedInMembers ?? '—' }}</strong>
      </div>
      <div class="stats-primary">
        <span>已登录并完成初始改密</span
        ><strong>{{ data?.activatedMembers ?? '—' }}<small>人</small></strong>
      </div>
      <div>
        <span>其余正常账号</span
        ><strong>{{ data?.pendingMembers ?? '—' }}</strong>
      </div>
    </div>
    <p class="stats-definition">
      完成人数需同时有成功登录、改密记录且当前无需改密。重置后尚未重新改密的账号不计入；未经历初始改密的预设管理员也不会凭空计入。
    </p>
  </section>
</template>
<style scoped>
.member-stats {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
  padding: 22px;
  margin: 26px 0;
}
.member-stats header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: start;
}
.member-stats h2 {
  font-size: 18px;
  margin-bottom: 6px;
}
.member-stats p {
  font-size: 12px;
  line-height: 1.8;
  color: var(--muted);
}
.member-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin: 22px 0 14px;
}
.member-stats-grid > div {
  background: #f5f8fc;
  border-radius: 7px;
  padding: 16px;
}
.member-stats-grid span {
  font-size: 12px;
  color: var(--muted);
}
.member-stats-grid strong {
  display: block;
  font: 30px var(--mono);
  color: var(--ink);
  margin-top: 8px;
}
.member-stats-grid small {
  font: 12px var(--font);
  margin-left: 8px;
}
.member-stats-grid .stats-primary {
  background: #eaf2ff;
}
.stats-primary strong {
  color: var(--blue);
}
.stats-definition {
  font-size: 11px !important;
}
@media (max-width: 700px) {
  .member-stats-grid {
    grid-template-columns: 1fr 1fr;
  }
  .member-stats {
    padding: 18px;
  }
  .member-stats-grid strong {
    font-size: 26px;
  }
}
</style>
