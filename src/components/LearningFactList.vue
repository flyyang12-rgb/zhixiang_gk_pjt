<script setup lang="ts">
import type { CurrentLearningFact } from '../api'
defineProps<{ facts: CurrentLearningFact[]; emptyText?: string }>()
const locatorLabels = { page: '页码', section: '章节', anchor: '定位' }
function scopeText(fact: CurrentLearningFact) {
  return [fact.school ? `${fact.school.name}的专业实例` : '专业范围', fact.scope.province,
    fact.scope.subjectGroup, fact.scope.admissionYear ? `${fact.scope.admissionYear} 年招生` : null].filter(Boolean).join(' · ')
}
function reviewDate(fact: CurrentLearningFact) {
  return fact.review.reviewedAt ? new Date(fact.review.reviewedAt).toLocaleDateString('zh-CN') : '待核验'
}
</script>

<template>
  <ul v-if="facts.length" class="learning-facts">
    <li v-for="fact in facts" :key="fact.id" :data-evidence-id="fact.id">
      <p class="learning-content">{{ fact.content }}</p>
      <p v-if="fact.kind === 'admission_requirement' && fact.condition" class="learning-content">
        <b>招生选科条件：</b>
        <template v-if="fact.condition.mode === 'all'">须全部选择 {{ fact.condition.subjects.join('、') }}</template>
        <template v-else-if="fact.condition.mode === 'any'">须在 {{ fact.condition.subjects.join('、') }} 中至少选择一门</template>
        <template v-else>官方材料明确未设选科限制</template>
        <small>（仅适用于下方学校、省份、科类及招生年份）</small>
      </p>
      <small>{{ scopeText(fact) }} · {{ fact.source.year }} 年材料</small>
      <details class="learning-source">
        <summary>查看来源与位置</summary>
        <a :href="fact.source.url" target="_blank" rel="noopener noreferrer">{{ fact.source.title }} ↗</a>
        <span>{{ fact.source.publisher }} · {{ fact.source.year }} 年材料</span>
        <span>{{ locatorLabels[fact.locator.kind] }}：{{ fact.locator.value }} · 核验于 {{ reviewDate(fact) }}</span>
      </details>
    </li>
  </ul>
  <p v-else class="learning-empty">{{ emptyText || '当前资料待补充' }}</p>
</template>

<style scoped>
.learning-facts{list-style:none;margin:0;padding:0;display:grid;gap:12px}.learning-facts li{padding:0 0 12px;border-bottom:1px solid #e3e8e1}.learning-facts li:last-child{border-bottom:0;padding-bottom:0}.learning-content{margin:0 0 5px;color:#273b30;font-size:14px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.learning-facts small,.learning-empty{color:#68796e;font-size:12px;line-height:1.7}.learning-empty{margin:0}.learning-source{margin-top:6px;font-size:12px;line-height:1.7;color:#617268}.learning-source summary{width:fit-content;color:#255c41;cursor:pointer;padding:4px 0}.learning-source a,.learning-source span{display:block;overflow-wrap:anywhere}.learning-source a{color:#245d43;text-underline-offset:3px}.learning-source summary:focus-visible,.learning-source a:focus-visible{outline:2px solid #497c60;outline-offset:3px}
</style>
