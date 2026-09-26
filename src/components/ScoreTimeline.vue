<script setup lang="ts">
import { computed, ref } from 'vue'
import { addScoreSnapshot, deleteScoreSnapshot, type PlanningCoordinate, type ScoreSnapshot } from '../api'
import { describeScoreTrend } from '../score-trend'
import { interactionError } from '../interaction-errors'
const props = defineProps<{ profileId: string; snapshots: ScoreSnapshot[]; coordinate: PlanningCoordinate }>()
const emit = defineEmits<{ changed: [] }>()
const showForm = ref(false), saving = ref(false), error = ref('')
const form = ref({ examName: '', examDate: new Date().toISOString().slice(0, 10), score: '', provinceRank: '', note: '' })
const trend = computed(() => describeScoreTrend(props.snapshots.map(item => ({ score: item.score, provinceRank: item.provinceRank }))))
const stabilityLabels = { single: '单次参考', preliminary: '初步参考', stable: '相对稳定', moderate: '有一定波动', volatile: '波动较大' }
const summary = computed(() => props.coordinate.rank ? `推荐使用综合规划位次 ${props.coordinate.rank.toLocaleString()} · ${props.coordinate.sampleCount} 次有效位次 · ${stabilityLabels[props.coordinate.stability]}` : '还没有可用的全省位次')
async function submit() {
  saving.value = true; error.value = ''
  try {
    await addScoreSnapshot(props.profileId, { examName: form.value.examName, examDate: form.value.examDate,
      score: Number(form.value.score), provinceRank: form.value.provinceRank ? Number(form.value.provinceRank) : null, note: form.value.note || null })
    showForm.value = false
    form.value = { examName: '', examDate: new Date().toISOString().slice(0, 10), score: '', provinceRank: '', note: '' }
    emit('changed')
  } catch (value) { error.value = interactionError(value, '模考坐标保存失败，请检查网络后重试') }
  finally { saving.value = false }
}
async function remove(id: number) {
  error.value = ''
  try { await deleteScoreSnapshot(props.profileId, id); emit('changed') }
  catch (value) { error.value = interactionError(value, '模考记录删除失败，请检查网络后重试') }
}
</script>

<template>
  <section class="score-timeline">
    <header><div><span class="kicker">模考坐标</span><h3>{{ trend }}</h3><strong class="planning-coordinate">{{ summary }}</strong><p>最近最多 5 次全省位次取中位数，减少单次波动；不平均分数，不预测高考。</p></div><button type="button" @click="showForm = !showForm">{{ showForm ? '收起' : '记一次模考' }}</button></header>
    <form v-if="showForm" class="score-form" @submit.prevent="submit"><label>考试名称<input v-model="form.examName" required maxlength="64" placeholder="例如：高二期末"></label><label>日期<input v-model="form.examDate" required type="date"></label><label>分数<input v-model="form.score" required type="number" min="100" max="750"></label><label>全省位次（联考/统考）<input v-model="form.provinceRank" type="number" min="1" placeholder="校内排名不要填"></label><label class="score-note">备注<input v-model="form.note" maxlength="200" placeholder="本次考试范围或异常情况"></label><button :disabled="saving">{{ saving ? '保存中…' : '保存为当前坐标' }}</button></form>
    <p v-if="error" class="comparison-error" role="alert">{{ error }}</p>
    <ol v-if="snapshots.length"><li v-for="snapshot in snapshots" :key="snapshot.id"><span>{{ snapshot.examDate }} · {{ snapshot.examName }}</span><b>{{ snapshot.score ?? '—' }} 分<template v-if="snapshot.provinceRank"> · 位次 {{ snapshot.provinceRank.toLocaleString() }}</template></b><em v-if="snapshot.isCurrent">当前坐标</em><button v-else type="button" @click="remove(snapshot.id)">删除</button></li></ol>
  </section>
</template>
