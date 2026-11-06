<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ClubArticle, ClubEvent } from '@electronic-club/shared'
import { imageSource } from '../media'
import { shortDate, eventLabel, publicationSummary } from '../presentation'
const props = defineProps<{ item: ClubArticle | ClubEvent }>()
const failed = ref(false)
watch(
  () => props.item.cover,
  () => {
    failed.value = false
  },
)
const isEvent = computed(() => 'startsAt' in props.item)
const href = computed(
  () => `${isEvent.value ? '/activities' : '/news'}/${props.item.id}`,
)
</script>
<template>
  <article class="publication-card">
    <RouterLink
      :to="href"
      class="publication-card-image"
      :aria-label="item.title"
      ><img
        v-if="item.cover && !failed"
        :src="imageSource(item.cover)"
        alt=""
        loading="lazy"
        decoding="async"
        @error="failed = true"
      />
      <div v-else class="publication-card-fallback" aria-hidden="true">
        <span>EC / {{ isEvent ? 'ACTIVITIES' : 'JOURNAL' }}</span
        ><strong>{{ isEvent ? '从实践出发' : '记录每一次探索' }}</strong
        ><i />
      </div>
      <span class="publication-card-badge">{{
        'startsAt' in item ? eventLabel(item) : item.category
      }}</span></RouterLink
    >
    <div class="publication-card-body">
      <div class="publication-card-meta">
        <span v-if="'pinned' in item && item.pinned" class="card-pinned"
          >置顶</span
        ><time>{{
          shortDate('startsAt' in item ? item.startsAt : item.publishedAt)
        }}</time
        ><span>{{
          'startsAt' in item ? item.location || '地点待定' : item.publisherName
        }}</span>
      </div>
      <h2>
        <RouterLink :to="href">{{ item.title }}</RouterLink>
      </h2>
      <p>{{ publicationSummary(item) || '查看详情，了解完整安排与内容。' }}</p>
      <RouterLink :to="href" class="publication-card-link"
        >{{ isEvent ? '查看活动' : '阅读全文'
        }}<span aria-hidden="true">→</span></RouterLink
      >
    </div>
  </article>
</template>
<style scoped>
.publication-card {
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  min-width: 0;
  transition:
    box-shadow 0.2s,
    transform 0.2s;
}
.publication-card:hover {
  box-shadow: 0 10px 30px #1837570d;
  transform: translateY(-2px);
}
.publication-card-image {
  display: block;
  aspect-ratio: 16/9;
  position: relative;
  background: #edf3fa;
  overflow: hidden;
}
.publication-card-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.4s;
}
.publication-card:hover img {
  transform: scale(1.025);
}
.publication-card-badge {
  position: absolute;
  left: 18px;
  bottom: 16px;
  background: #fffef5f2;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  color: #143e68;
}
.publication-card-fallback {
  height: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: linear-gradient(120deg, #eaf2fd, #f8fafc);
  position: relative;
  overflow: hidden;
  color: #1a4b81;
}
.publication-card-fallback span {
  font: 10px var(--mono);
  letter-spacing: 0.1em;
  position: relative;
  z-index: 1;
}
.publication-card-fallback strong {
  font-size: 23px;
  letter-spacing: -0.04em;
  margin-top: 14px;
  position: relative;
  z-index: 1;
}
.publication-card-fallback i {
  position: absolute;
  width: 160px;
  height: 160px;
  border: 1px solid #c8dbf3;
  right: -40px;
  top: 15%;
  transform: rotate(35deg);
  box-shadow:
    0 0 0 20px #dce9fa66,
    0 0 0 40px #e4eefb80;
}
.publication-card-body {
  padding: 22px 24px 20px;
}
.publication-card-meta {
  display: flex;
  gap: 10px;
  align-items: center;
  color: var(--muted);
  font-size: 11px;
  flex-wrap: wrap;
}
.publication-card-meta > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.publication-card h2 {
  font-size: 21px;
  line-height: 1.5;
  margin: 12px 0 10px;
  text-wrap: initial;
  overflow-wrap: anywhere;
}
.publication-card-body > p {
  font-size: 13px;
  line-height: 1.9;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 3.8em;
}
.publication-card-link {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--blue);
  border-top: 1px solid #e9eef5;
  margin-top: 20px;
  padding-top: 14px;
}
.card-pinned {
  color: var(--blue);
}
@media (prefers-reduced-motion: reduce) {
  .publication-card,
  .publication-card-image img {
    transition: none;
  }
  .publication-card:hover {
    transform: none;
  }
}
@media (max-width: 600px) {
  .publication-card-body {
    padding: 18px 20px;
  }
  .publication-card h2 {
    font-size: 20px;
  }
}
</style>
