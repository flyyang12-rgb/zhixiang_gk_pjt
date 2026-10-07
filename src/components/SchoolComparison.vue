<script setup lang="ts">
import type { SchoolDetail, SavedItem } from '../api'
import ComparisonPdfButton from './ComparisonPdfButton.vue'
defineProps<{ profileId: string; details: SchoolDetail[]; savedItems: SavedItem[]; analysis: string; analysisMode: 'ai' | 'local' | null; analysisLoading: boolean; analysisError: string; saving: (type: 'school', id: number) => boolean }>()
const emit = defineEmits<{ back: []; school: [number]; remove: [SchoolDetail]; refreshAnalysis: [] }>()
const rows = ['学校与城市', '当前档案招生位置', '选科与招生单元', '经核验优势专业', '数据缺口', '家庭原始备注']
const unitLabels: Record<string, string> = { exact_major: '具体专业', major_group: '院校专业组', school_line: '学校线' }
function gaps(d: SchoolDetail) { return [!d.admissionContext?.records.length ? '当前档案无可比招生记录' : null, !d.featuredMajors.length ? '暂无经核验优势专业' : null, !d.school.officialUrl ? '学校官网待核验' : null, !d.school.admissionsUrl ? '招生官网待核验' : null].filter(Boolean) }
</script>
<template>
  <section class="school-comparison" aria-label="院校比较">
    <header class="comparison-toolbar"><button type="button" class="comparison-back" @click="emit('back')">← 返回收藏</button><ComparisonPdfButton :profile-id="profileId" kind="school" :ids="details.map(d => d.school.id)" :disabled="details.length < 2" /></header>
    <span class="comparison-eyebrow">当前档案 · 已核验事实</span><h3>院校对比</h3><p class="comparison-context">并排看 {{ details.length }} 所院校。招生位置按具体招生单元核对。</p>
    <p class="comparison-scroll-hint">左右滑动查看所有学校；同一行比较同一维度。</p>
    <div class="comparison-table-wrap" tabindex="0" role="region" aria-label="可横向滚动的院校比较表">
      <table class="comparison-table" :style="{ '--comparison-columns': details.length }">
        <thead><tr><th scope="col" class="comparison-dimension">比较维度</th><th v-for="d in details" :key="d.school.id" scope="col" class="school-comparison-column"><small>{{ d.school.province }} · {{ d.school.city }}</small><button type="button" class="comparison-school-name" :aria-label="`查看 ${d.school.name} 详情`" @click="emit('school', d.school.id)">{{ d.school.name }} →</button><button type="button" class="comparison-remove" :disabled="saving('school', d.school.id)" @click="emit('remove', d)">移出收藏</button></th></tr></thead>
        <tbody><tr v-for="(row, index) in rows" :key="row"><th scope="row">{{ row }}</th><td v-for="d in details" :key="d.school.id">
          <template v-if="index === 0"><p>{{ d.school.level }} · {{ d.school.schoolType }}</p><p>{{ d.school.province }} · {{ d.school.city }}</p></template>
          <template v-else-if="index === 1"><template v-if="d.admissionContext?.records.length"><p>{{ d.admissionContext.years.join('、') }} 年 · {{ d.admissionContext.records.length }} 条记录</p><p class="comparison-context">{{ d.admissionContext.provinceRank === null ? '未形成规划位次，不生成冲稳保' : `规划位次 ${d.admissionContext.provinceRank.toLocaleString()}，各单元位置见下一行` }}</p></template><p v-else class="comparison-context">暂无可比招生记录</p></template>
          <template v-else-if="index === 2"><details v-if="d.admissionContext?.records.length" class="comparison-records"><summary>查看 {{ d.admissionContext.records.length }} 条招生记录</summary><article v-for="r in d.admissionContext.records" :key="r.id"><b>{{ r.year }} · {{ r.unitName }}</b><small>{{ unitLabels[r.unitType] }} · {{ r.batch }}</small><p>{{ r.subjectRequirement?.trim() || '选科要求待核验，未知不表示不限' }}</p><p>最低位次 {{ r.minRank?.toLocaleString() ?? '待核验' }} · {{ r.risk ?? '仅供浏览' }} · {{ r.confidence }}置信</p><p v-if="r.recommendationExclusionReason" class="comparison-context">{{ r.recommendationExclusionReason }}</p><a v-if="r.sourceUrl" :href="r.sourceUrl" target="_blank" rel="noopener noreferrer">{{ r.publisher ?? '招生来源' }} ↗</a><small v-else>来源待核验</small></article></details><p v-else class="comparison-context">选科材料待核验，未知不表示不限。</p></template>
          <template v-else-if="index === 3"><ul v-if="d.featuredMajors.length" class="comparison-facts"><li v-for="m in d.featuredMajors" :key="m.id"><b>{{ m.name }}</b><small>{{ m.recognitionType }} · {{ m.recognitionYear ?? m.sourceYear }} 年{{ m.recognitionYear === null ? '名录' : '认定' }}</small><a :href="m.sourceUrl" target="_blank" rel="noopener noreferrer">{{ m.publisher }} ↗</a></li></ul><p v-else class="comparison-context">暂无经核验数据</p></template>
          <ul v-else-if="index === 4" class="comparison-gaps"><li v-for="gap in gaps(d)" :key="String(gap)">{{ gap }}</li><li v-if="!gaps(d).length">仍需核对当年招生计划与培养成本</li></ul>
          <p v-else class="comparison-note">{{ savedItems.find(item => item.itemType === 'school' && item.itemId === d.school.id)?.note ?? '未添加家庭讨论备注' }}</p>
        </td></tr></tbody>
      </table>
    </div>
    <section class="comparison-analysis" aria-live="polite"><header><b>讨论提示</b><small v-if="analysisMode">{{ analysisMode === 'ai' ? '顾问解读' : '规则解读' }} · PDF 保留原始证据</small></header><p v-if="analysisLoading" class="analysis-loading">正在对比已核验信息…</p><div v-else-if="analysis" class="analysis-content">{{ analysis }}</div><p v-else-if="analysisError" class="analysis-error">{{ analysisError }} <button type="button" @click="emit('refreshAnalysis')">重试</button></p></section>
  </section>
</template>
