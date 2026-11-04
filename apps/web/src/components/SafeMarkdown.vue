<script setup lang="ts">
import { computed } from 'vue'
import { imageLine } from '@electronic-club/shared'
import { mediaUrl } from '../media'
const props = defineProps<{
  content: string
  imagePreviews?: Record<string, string>
}>()
type Block =
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'image'; id: string; alt: string }
  | { kind: 'h2' | 'h3' | 'p' | 'list'; text: string }
const cells = (s: string) =>
  s
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
const blocks = computed(() => {
  const lines = props.content.split('\n'),
    out: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!,
      image = imageLine(line)
    if (image) {
      out.push({ kind: 'image', ...image })
      continue
    }
    if (
      line.includes('|') &&
      lines[i + 1] &&
      cells(lines[i + 1]!).length === cells(line).length &&
      cells(lines[i + 1]!).every((c) => /^:?-{3,}:?$/.test(c))
    ) {
      const headers = cells(line),
        rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes('|')) {
        const row = cells(lines[i]!)
        rows.push(headers.map((_, j) => row[j] ?? ''))
        i++
      }
      i--
      out.push({ kind: 'table', headers, rows })
      continue
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    out.push(
      heading
        ? { kind: heading[1]!.length === 3 ? 'h3' : 'h2', text: heading[2]! }
        : line.startsWith('- ')
          ? { kind: 'list', text: line.slice(2) }
          : { kind: 'p', text: line || '\u00a0' },
    )
  }
  return out
})
</script>
<template>
  <div class="safe-markdown">
    <template v-for="(block, i) in blocks" :key="i"
      ><figure v-if="block.kind === 'image'" class="body-image">
        <img
          :src="imagePreviews?.[block.id] ?? mediaUrl(block.id)"
          :alt="block.alt"
          loading="lazy"
          decoding="async"
        />
        <figcaption v-if="block.alt !== '正文图片'">{{ block.alt }}</figcaption>
      </figure>
      <div
        v-else-if="block.kind === 'table'"
        class="body-table"
        tabindex="0"
        role="region"
        aria-label="正文表格"
      >
        <table>
          <thead>
            <tr>
              <th v-for="(cell, j) in block.headers" :key="j">{{ cell }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, j) in block.rows" :key="j">
              <td v-for="(cell, k) in row" :key="k">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h2 v-else-if="block.kind === 'h2'">{{ block.text }}</h2>
      <h3 v-else-if="block.kind === 'h3'">{{ block.text }}</h3>
      <p v-else :class="{ 'markdown-list': block.kind === 'list' }">
        {{ block.kind === 'list' ? '• ' : '' }}{{ block.text }}
      </p></template
    >
  </div>
</template>
<style scoped>
.safe-markdown {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.9;
  min-width: 0;
}
.safe-markdown h2 {
  font-size: 1.5em;
  margin: 1.2em 0 0.5em;
  line-height: 1.5;
}
.safe-markdown h3 {
  font-size: 1.2em;
  margin: 1em 0 0.4em;
  line-height: 1.5;
}
.safe-markdown p {
  margin: 0.4em 0;
}
.markdown-list {
  padding-left: 1em;
}
.body-image {
  margin: 24px 0;
  white-space: normal;
}
.body-image img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: auto;
  border-radius: 6px;
}
.body-image figcaption {
  text-align: center;
  font-size: 12px;
  color: #667d94;
  margin-top: 8px;
}
.body-table {
  max-width: 100%;
  overflow-x: auto;
  margin: 20px 0;
  white-space: normal;
}
.body-table table {
  border-collapse: collapse;
  min-width: 100%;
  font-size: 14px;
}
.body-table th,
.body-table td {
  padding: 10px 14px;
  border: 1px solid #dce4ef;
  text-align: left;
  min-width: 72px;
  word-break: normal;
}
.body-table th {
  background: #edf3fa;
  font-weight: 600;
}
.body-table tbody tr:nth-child(even) {
  background: #f8fafd;
}
</style>
