<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { getMajorExploration, getMajorExplorationCatalog, getMajorExplorationDetail, removeDashboardItem,
  saveDashboardItem, updateDashboardItemNote, type AdvisorFocus, type ExplorationCatalog, type ExplorationList,
  type ExplorationMajorDetail, type SavedItem } from '../api'
import LearningFactList from './LearningFactList.vue'
import { interactionError } from '../interaction-errors'

const props = defineProps<{ profileId: string; studentName: string; list: ExplorationList | null;
  savedItems: SavedItem[]; initialMajorId?: number | null; modalOpen?: boolean; hasPlanningRank?: boolean; detailOnly?: boolean }>()
const emit = defineEmits<{ school: [number]; advisor: [{ prompt: string; focus: AdvisorFocus }]; collection: [];
  saved: [{ itemId: number; name: string; state: SavedItem['state'] | null; note: string | null; confirm?: boolean }]; feedback: [string]; closeDetail: [] }>()
const list = ref(props.list)
const view = ref<'initial' | 'catalog'>('initial')
const catalog = ref<ExplorationCatalog | null>(null)
const catalogLoading = ref(false), catalogError = ref(''), listRefreshing = ref(false), refreshError = ref('')
const filters = reactive({ search: '', category: '' })
const pageSize = 9
const detail = ref<ExplorationMajorDetail | null>(null), detailId = ref<number | null>(null)
const detailLoading = ref(false), detailError = ref(''), detailPanel = ref<HTMLElement | null>(null)
const actionError = ref(''), busyId = ref<number | null>(null), noteDraft = ref(''), noteSaving = ref(false), noteMessage = ref('')
let catalogRequest = 0, detailRequest = 0, listRequest = 0, noteRequest = 0, lastTrigger: HTMLElement | null = null
let previousScroll = 0, previousWindowScroll = 0, alive = true
let returnMajorId: number | null = null
const visibleCards = computed(() => (view.value === 'catalog' ? catalog.value?.items ?? [] : list.value?.cards ?? [])
  .filter(card => view.value === 'catalog' || savedItem(card.id)?.state !== 'excluded'))
const categories = computed(() => catalog.value?.categories ?? [])
const pageCount = computed(() => Math.max(1, Math.ceil((catalog.value?.total ?? 0) / pageSize)))
const activeSaved = computed(() => detailId.value === null ? undefined : savedItem(detailId.value))
const canAsk = computed(() => detail.value?.status === 'available' || activeSaved.value?.state === 'saved')
const admissionLabels = { known: '当前范围已有选科证据', unknown: '选科要求待核验', not_met: '不符合该范围要求', conflicting: '选科材料有冲突' }
const availabilityLabels = { pending: '待审核', conflicting: '有冲突', rejected: '未通过审核', withdrawn: '已撤回', expired: '已到期', invalid: '登记不完整' }
watch(() => props.list, value => { list.value = value })
watch(() => props.initialMajorId, id => { if (id && id !== detailId.value) void openDetail(id) })
onMounted(() => {
  void loadCatalog(1, false)
  if (props.initialMajorId) void openDetail(props.initialMajorId)
  window.addEventListener('keydown', onWindowKey)
})
onBeforeUnmount(() => { alive = false; catalogRequest++; detailRequest++; listRequest++; noteRequest++; window.removeEventListener('keydown', onWindowKey) })
function savedItem(id: number) { return props.savedItems.find(item => item.itemType === 'major' && item.itemId === id) }
function scrollContainer() { return detailPanel.value?.closest<HTMLElement>('.profession-dashboard') ?? document.querySelector<HTMLElement>('.profession-dashboard') }
async function loadCatalog(page = 1, enter = true) {
  if (!alive) return
  if (enter) view.value = 'catalog'
  const request = ++catalogRequest
  catalogLoading.value = true; catalogError.value = ''
  try {
    const result = await getMajorExplorationCatalog(props.profileId, { ...filters, page, pageSize, admissionYear: list.value?.admissionYear })
    if (alive && request === catalogRequest) catalog.value = result
  } catch (value) { if (alive && request === catalogRequest) catalogError.value = interactionError(value, '目录加载失败，请检查网络后重试') }
  finally { if (alive && request === catalogRequest) catalogLoading.value = false }
}
function clearFilters() { filters.search = ''; filters.category = ''; view.value = 'initial'; void loadCatalog(1, false) }
async function openDetail(id: number, trigger?: Event) {
  if (!alive) return
  if (detailId.value === null) {
    returnMajorId = id
    lastTrigger = trigger?.currentTarget instanceof HTMLElement ? trigger.currentTarget : document.activeElement instanceof HTMLElement ? document.activeElement : null
    previousScroll = scrollContainer()?.scrollTop ?? 0
    previousWindowScroll = window.scrollY
  }
  noteRequest++; noteSaving.value = false
  detailId.value = id; detail.value = null; detailError.value = ''; actionError.value = ''; noteMessage.value = ''
  const request = ++detailRequest
  detailLoading.value = true
  await nextTick(); detailPanel.value?.focus({ preventScroll: true })
  if (!alive || request !== detailRequest) return
  scrollContainer()?.scrollTo({ top: 0, behavior: 'instant' })
  const container = scrollContainer()
  if (container) window.scrollTo({ top: Math.max(0, container.getBoundingClientRect().top + window.scrollY - 80), behavior: 'instant' })
  try {
    const result = await getMajorExplorationDetail(props.profileId, id, { admissionYear: list.value?.admissionYear })
    if (!alive || request !== detailRequest) return
    detail.value = result; noteDraft.value = result.note ?? ''
    emit('saved', { itemId: id, name: result.identity.name, state: result.savedState, note: result.note })
  } catch (value) { if (alive && request === detailRequest) detailError.value = interactionError(value, '专业详情加载失败，请检查网络后重试') }
  finally { if (alive && request === detailRequest) detailLoading.value = false }
}
async function reloadDetail() {
  if (!alive || detailId.value === null) return
  noteRequest++; noteSaving.value = false
  const id = detailId.value, request = ++detailRequest
  detailLoading.value = true; detailError.value = ''
  try {
    const result = await getMajorExplorationDetail(props.profileId, id, { admissionYear: list.value?.admissionYear })
    if (alive && request === detailRequest) {
      detail.value = result; noteDraft.value = result.note ?? ''
      emit('saved', { itemId: id, name: result.identity.name, state: result.savedState, note: result.note })
    }
  } catch (value) { if (alive && request === detailRequest) detailError.value = interactionError(value, '专业详情刷新失败，请检查网络后重试') }
  finally { if (alive && request === detailRequest) detailLoading.value = false }
}
async function closeDetail() {
  detailRequest++; noteRequest++; noteSaving.value = false; detailId.value = null; detail.value = null; detailError.value = ''; detailLoading.value = false
  if (props.detailOnly) { emit('closeDetail'); return }
  await nextTick(); if (!alive) return
  scrollContainer()?.scrollTo({ top: previousScroll, behavior: 'instant' })
  window.scrollTo({ top: previousWindowScroll, behavior: 'instant' })
  if (lastTrigger?.isConnected) lastTrigger.focus({ preventScroll: true })
  else {
    const card = returnMajorId === null ? null : document.querySelector<HTMLElement>(`.exploration-workspace [data-major-id="${returnMajorId}"] .exploration-row-main`)
    if (card) card.focus({ preventScroll: true })
    else document.querySelector<HTMLElement>('.exploration-workspace .exploration-directory-button')?.focus({ preventScroll: true })
  }
}
function onWindowKey(event: KeyboardEvent) {
  if (event.defaultPrevented || event.key !== 'Escape' || detailId.value === null || props.modalOpen || document.querySelector('.school-detail-drawer')) return
  event.preventDefault(); void closeDetail()
}
async function refresh(reloadCurrentDetail = true) {
  if (!alive) return
  const request = ++listRequest
  listRefreshing.value = true; refreshError.value = ''
  try {
    const result = await getMajorExploration(props.profileId, list.value?.admissionYear)
    if (alive && request === listRequest) list.value = result
  } catch (value) { if (alive && request === listRequest) refreshError.value = interactionError(value, '探索清单刷新失败，请检查网络后重试') }
  finally { if (alive && request === listRequest) listRefreshing.value = false }
  if (!alive || request !== listRequest) return
  if (view.value === 'catalog') await loadCatalog(catalog.value?.page ?? 1)
  if (reloadCurrentDetail && detailId.value !== null) await reloadDetail()
}
async function changeState(id: number, name: string, state: 'saved' | 'excluded') {
  if (!alive || busyId.value !== null) return
  busyId.value = id; actionError.value = ''
  const existing = savedItem(id)
  const profileId = props.profileId
  try {
    const removing = state === 'saved' && existing?.state === 'saved'
    if (removing) await removeDashboardItem(profileId, 'major', id)
    else await saveDashboardItem(profileId, { itemType: 'major', itemId: id, state })
    if (!alive || props.profileId !== profileId) return
    const currentItem = savedItem(id)
    const currentNote = currentItem ? currentItem.note ?? null : existing?.note ?? null
    if (detail.value?.identity.id === id) {
      detail.value.savedState = removing ? null : state
      detail.value.note = removing ? null : currentNote
    }
    emit('saved', { itemId: id, name, state: removing ? null : state, note: removing ? null : currentNote, confirm: !removing && state === 'saved' })
    emit('feedback', removing ? `已取消关注“${name}”` : state === 'excluded' ? `已暂时排除“${name}”，目录仍可查阅；备注保留` : existing?.state === 'excluded' ? `已恢复并关注“${name}”，保存到“${props.studentName}”的公开档案；备注保留` : `已关注“${name}”，保存到“${props.studentName}”的公开档案`)
    // A state change does not change learning material or the note draft. Reloading
    // this detail after list/catalog reads could replace edits made in the meantime.
    await refresh(false)
  } catch (value) { if (alive && props.profileId === profileId) actionError.value = interactionError(value, '保存失败，请检查网络后重试') }
  finally { if (alive && props.profileId === profileId) busyId.value = null }
}
async function saveNote() {
  if (!alive || !detail.value || !activeSaved.value || noteSaving.value) return
  if (noteDraft.value.length > 500) { noteMessage.value = '家庭备注不能超过 500 字'; return }
  const id = detail.value.identity.id, name = detail.value.identity.name
  const profileId = props.profileId, itemState = activeSaved.value.state
  const request = ++noteRequest, viewRequest = detailRequest
  const submittedDraft = noteDraft.value, note = submittedDraft || null
  noteSaving.value = true; noteMessage.value = ''
  try {
    const result = await updateDashboardItemNote(profileId, 'major', id, note)
    if (!alive || props.profileId !== profileId) return
    const currentItem = savedItem(id)
    if (currentItem) emit('saved', { itemId: id, name, state: currentItem.state ?? itemState, note: result.note })
    if (request === noteRequest && viewRequest === detailRequest && detail.value?.identity.id === id) {
      detail.value.note = result.note
      if (noteDraft.value === submittedDraft) {
        noteDraft.value = result.note ?? ''
        noteMessage.value = `家庭备注已保存到“${props.studentName}”的公开档案`
      } else noteMessage.value = '已保存先前备注，当前修改尚未保存'
    }
  } catch (value) {
    if (alive && props.profileId === profileId && request === noteRequest && viewRequest === detailRequest && detailId.value === id)
      noteMessage.value = interactionError(value, '备注保存失败，请检查网络后重试')
  } finally { if (alive && request === noteRequest && viewRequest === detailRequest && detailId.value === id) noteSaving.value = false }
}
function askAdvisor() {
  if (!detail.value || !canAsk.value) return
  emit('advisor', { prompt: `请解释${detail.value.identity.name}已核验的学习内容、学习活动和职业门槛，并指出当前资料缺口。只谈专业探索，不判断个人适合度或录取。`,
    focus: { type: 'major', majorId: detail.value.identity.id, majorName: detail.value.identity.name } })
}
function saveLabel(id: number) { return savedItem(id)?.state === 'saved' ? '取消关注' : savedItem(id)?.state === 'excluded' ? '恢复并关注' : '关注专业' }
function unavailableSchoolName(schoolId: number) {
  const facts = detail.value ? [...Object.values(detail.value.facts).flat(), ...detail.value.otherInstances] : []
  return facts.find(fact => fact.school?.id === schoolId)?.school?.name ?? '学校实例，身份材料需重新核验'
}
defineExpose({ openDetail, refresh })
</script>

<template>
  <section class="exploration-workspace" aria-label="专业探索工作台">
    <header v-if="detailId === null" class="exploration-header">
      <div><span class="exploration-stage">{{ hasPlanningRank ? '专业学习资料' : '目标探索' }}</span><h2>先了解专业，再决定关注哪些方向</h2><p>{{ hasPlanningRank ? '当前已有规划位次，这些材料用于专业探索；招生判断另看当前位次与资格。' : '当前没有可靠全省位次，只比较学习与职业证据。' }}已选档案：{{ studentName }}。</p></div>
      <button type="button" class="exploration-collection" @click="emit('collection')">我的收藏 <b>{{ savedItems.filter(item => item.state === 'saved' || item.state === 'target').length }}</b></button>
    </header>
    <p v-if="actionError" class="exploration-error" role="alert">{{ actionError }}</p>
    <p v-if="refreshError" class="exploration-error" role="alert">{{ refreshError }} <button type="button" @click="refresh()">重试</button></p>
    <template v-if="detailId === null">
      <form class="exploration-search" @submit.prevent="loadCatalog(1)">
        <label>按专业名称查阅<input v-model="filters.search" type="search" maxlength="100" placeholder="输入专业名称"></label>
        <label>专业类别<select v-model="filters.category"><option value="">全部专业类别</option><option v-for="category in categories" :key="category">{{ category }}</option></select></label>
        <button type="submit" :disabled="catalogLoading">查阅目录</button><button type="button" class="exploration-directory-button" @click="clearFilters">返回探索清单 / 清除筛选</button>
      </form>
      <p class="exploration-coverage" v-if="list">已审核资料 {{ list.coverage.reviewedMajorCount }} 个专业 · 完整条目 {{ list.coverage.completeMajorCount }} 个 · 有缺口 {{ list.coverage.incompleteMajorCount }} 个<template v-if="list.coverage.sourceYears.length"> · 材料年份 {{ list.coverage.sourceYears.join(' / ') }}</template></p>
      <p v-if="view === 'initial' && visibleCards.some(card => card.status === 'pending')" class="exploration-order">先从这 {{ visibleCards.length }} 个专业方向开始了解，可以查看、收藏和比较。标注“资料待补充”的方向暂不判断适合度或能否报考。</p>
      <p class="exploration-order">{{ view === 'initial' ? list?.orderNote : '目录按专业类别、代码与 ID 浏览，顺序不表示适合度；暂时排除的专业仍可查阅。' }}</p>
      <p v-if="catalogError" class="exploration-error" role="alert">{{ catalogError }} <button type="button" @click="loadCatalog(catalog?.page ?? 1, view === 'catalog')">重试目录</button></p>
      <p v-if="catalogLoading && view === 'catalog'" class="exploration-state" role="status">正在读取专业目录…</p>
      <p v-else-if="!visibleCards.length" class="exploration-state">{{ view === 'catalog' ? '当前查询没有匹配条目。可以清除筛选，或换一个完整专业名称。' : '当前可展示的审核资料不足。可以查阅目录、查看已有收藏；缺少资料不代表专业不存在或就业差。' }}</p>
      <div v-else class="exploration-list" :aria-busy="listRefreshing || catalogLoading">
        <article v-for="card in visibleCards" :key="card.id" class="exploration-row" :class="{ 'has-material': card.status === 'available' }" :data-major-id="card.id">
          <button type="button" class="exploration-row-main" :aria-label="`查看 ${card.name} 专业详情`" @click="openDetail(card.id, $event)">
            <div class="exploration-card-meta"><small>{{ card.category }}</small><span>{{ card.code }}</span></div><h3>{{ card.name }}</h3>
            <small class="exploration-card-status">{{ card.status === 'available' ? '有审核资料' : card.status === 'pending' ? '资料待补充' : '资料需重新核验' }}</small>
            <p v-if="card.status === 'available'">{{ card.curriculum[0]?.content || '课程材料待补充' }}</p><p v-else>{{ card.status === 'pending' ? '课程、实践与职业方向资料待补充。可先关注，记录想了解的问题。' : '资料当前不可用，需要重新核验' }}</p>
            <small v-if="card.curriculum[0]">{{ card.curriculum[0].school ? `${card.curriculum[0].school.name}的专业实例` : '专业范围' }} · {{ card.curriculum[0].source.year }} 年材料</small>
            <span v-if="card.status === 'available'">{{ card.completeness.complete ? '课程、学习活动与职业方向均有审核资料' : card.completeness.missing.join('；') }}</span>
            <span class="exploration-admission">{{ admissionLabels[card.admission.status] }}<template v-if="savedItem(card.id)?.state === 'excluded'"> · 已暂时排除</template></span>
            <span class="exploration-card-link">查看专业详情 <span aria-hidden="true">→</span></span>
          </button>
          <button type="button" class="exploration-save" :disabled="busyId !== null" :aria-label="`${saveLabel(card.id)} ${card.name}`" @click="changeState(card.id, card.name, 'saved')">{{ busyId === card.id ? '保存中…' : saveLabel(card.id) }}</button>
        </article>
      </div>
      <nav v-if="view === 'catalog' && catalog" class="exploration-pagination" aria-label="专业目录分页">
        <button type="button" :disabled="catalog.page <= 1 || catalogLoading" @click="loadCatalog(catalog.page - 1)">上一页</button>
        <span>共 {{ catalog.total }} 项 · 第 {{ catalog.page }} / {{ pageCount }} 页</span>
        <button type="button" :disabled="catalog.page >= pageCount || catalogLoading" @click="loadCatalog(catalog.page + 1)">下一页</button>
      </nav>
      <details v-if="list?.dataGaps.length" class="exploration-gaps"><summary>当前资料缺口</summary><ul><li v-for="gap in list.dataGaps" :key="gap">{{ gap }}</li></ul></details>
    </template>
    <article v-else ref="detailPanel" class="exploration-detail" tabindex="-1" :aria-label="detail ? `${detail.identity.name} 专业详情` : '专业详情'">
      <nav class="exploration-detail-nav"><button type="button" @click="closeDetail">← 返回{{ detailOnly ? '招生工作台' : view === 'catalog' ? '目录' : '探索清单' }}</button><button type="button" :disabled="detailLoading" @click="reloadDetail">刷新当前材料</button><small>Esc 返回</small></nav>
      <p v-if="detailLoading" class="exploration-state" role="status">正在读取当前专业材料…</p>
      <div v-else-if="detailError" class="exploration-error" role="alert"><p>{{ detailError }}</p><button type="button" @click="reloadDetail">重试详情</button></div>
      <template v-else-if="detail">
        <header class="exploration-detail-header"><small>{{ detail.identity.category }} · {{ detail.identity.code }}</small><h2>{{ detail.identity.name }}</h2><p v-if="detail.status !== 'available'">{{ detail.status === 'pending' ? '资料待补充' : '资料已失效、撤回或尚需重新核验' }}。专业身份与已有备注保留，缺口不代表这个专业前景差。</p>
          <button type="button" class="exploration-save" :disabled="busyId !== null" @click="changeState(detail.identity.id, detail.identity.name, 'saved')">{{ busyId === detail.identity.id ? '保存中…' : saveLabel(detail.identity.id) }}</button>
        </header>
        <div class="exploration-detail-content">
        <section class="exploration-section"><h3>学什么</h3><LearningFactList :facts="detail.facts.curriculum" empty-text="课程材料待补充，不根据专业名称猜课程。" /></section>
        <section class="exploration-section"><h3>怎么学</h3><LearningFactList :facts="detail.facts.learning_activity" empty-text="学习活动材料待补充，暂不判断实验、项目或实践负担。" /></section>
        <section v-if="detail.facts.learning_prerequisite.length || detail.facts.course_prerequisite.length" class="exploration-section"><h3>学习准备与课程先修</h3><p class="exploration-explanation">以下是学习知识或大学课程条件，不是高考选科资格。</p><LearningFactList :facts="[...detail.facts.learning_prerequisite, ...detail.facts.course_prerequisite]" /></section>
        <section class="exploration-section"><h3>职业方向与门槛</h3><p v-if="!detail.careerDirections.length" class="exploration-explanation">职业方向资料不足，暂不拼凑毕业去向。</p><article v-for="direction in detail.careerDirections" :key="direction.id" class="exploration-career"><h4>{{ direction.name }}</h4><LearningFactList :facts="direction.evidence" /><h5>读研、考证或职业准入</h5><LearningFactList :facts="direction.requirements" empty-text="门槛材料待补充，不能据此认定本科可直接进入。" /></article></section>
        <section class="exploration-section"><h3>选科证据</h3><p class="exploration-explanation">{{ detail.admission.reason }}。核对范围使用 {{ detail.admission.admissionYear }} 招生年，材料年另外标明。</p><LearningFactList :facts="detail.facts.admission_requirement" empty-text="当前缺少已核验的选科材料；未知不表示不限。" /></section>
        <section class="exploration-section"><h3>了解专业的学校例子</h3><p class="exploration-explanation">培养材料是对应学校与年份的实例，不能据此认定当前可报或位次可达。</p><p v-if="!detail.schoolExamples.length" class="exploration-explanation">具体专业的学校学习实例待补充，仍可继续了解专业。</p><article v-for="school in detail.schoolExamples" :key="school.id" class="exploration-school"><button type="button" :aria-label="`查看 ${school.name} 学校详情`" @click="emit('school', school.id)">{{ school.name }} →</button><span>{{ school.sourceYears.join(' / ') }} 年材料 · {{ admissionLabels[school.admission.status] }}</span><p>{{ school.admission.reason }}</p><LearningFactList :facts="school.evidence" /></article></section>
        <section class="exploration-section"><h3>当前缺口与下一步</h3><ul class="exploration-detail-gaps"><li v-for="gap in detail.dataGaps" :key="gap">{{ gap }}</li></ul><details v-if="detail.unavailableEvidence.length"><summary>查看不可用材料的范围</summary><ul class="exploration-detail-gaps"><li v-for="(gap, index) in detail.unavailableEvidence" :key="`${gap.evidenceId}-${index}`">{{ availabilityLabels[gap.status] }} · {{ gap.sourceYear ? `${gap.sourceYear} 年材料` : '材料年份待核验' }}<template v-if="gap.scope?.schoolId"> · {{ unavailableSchoolName(gap.scope.schoolId) }}</template><template v-if="gap.scope?.province"> · {{ gap.scope.province }}</template><template v-if="gap.scope?.admissionYear"> · {{ gap.scope.admissionYear }} 招生年</template>：{{ gap.reason }}</li></ul></details><p class="exploration-next"><b>下一步只做：</b>{{ detail.nextAction }}</p></section>
        <section class="exploration-section exploration-note-editor"><h3>家庭讨论备注</h3><p class="exploration-explanation">保存到“{{ studentName }}”的公开档案，所有访客可查看、修改或删除。备注只记录自己的想法，不作为专业事实或排序依据。</p>
          <form v-if="activeSaved" @submit.prevent="saveNote"><label :for="`exploration-note-${detail.identity.id}`">愿意了解的内容、担心或待核验问题</label><textarea :id="`exploration-note-${detail.identity.id}`" v-model="noteDraft" maxlength="500" :aria-label="`${detail.identity.name} 家庭讨论备注`" rows="4"></textarea><footer><small>{{ noteDraft.length }} / 500</small><button type="submit" :disabled="noteSaving">{{ noteSaving ? '保存中…' : '保存家庭备注' }}</button></footer></form>
          <p v-else class="exploration-explanation">先关注这个专业，再保存家庭备注。</p><p v-if="noteMessage" role="status" class="exploration-note-message">{{ noteMessage }}</p>
        </section>
        </div>
        <footer class="exploration-detail-actions"><button type="button" :disabled="!canAsk" @click="askAdvisor">问顾问：学习或职业问题</button><button v-if="activeSaved?.state !== 'excluded'" type="button" :disabled="busyId !== null" @click="changeState(detail.identity.id, detail.identity.name, 'excluded')">暂时排除专业</button><span v-else>已暂时排除，可通过“恢复并关注”保留讨论。</span></footer>
      </template>
    </article>
  </section>
</template>

<style scoped>
.exploration-workspace{font-size:14px;line-height:1.65}.exploration-workspace button,.exploration-workspace input,.exploration-workspace select,.exploration-workspace textarea{font:inherit}.exploration-workspace button{cursor:pointer;min-height:36px;border:1px solid #ccd8cf;border-radius:7px;background:#fff;padding:6px 11px;color:#28583f}.exploration-workspace button:disabled{cursor:default;opacity:.55}.exploration-workspace :focus-visible{outline:2px solid #467859;outline-offset:3px}.exploration-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:22px}.exploration-stage{font-size:12px;font-weight:700;color:#315e46}.exploration-header h2{font-size:24px;line-height:1.4;margin:5px 0 8px}.exploration-header p{font-size:13px;color:#66766d;margin:0}.exploration-collection{flex:none;white-space:nowrap}.exploration-collection b{margin-left:6px}.exploration-search{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;margin-bottom:14px}.exploration-search label{display:grid;gap:5px;font-size:12px;color:#617567}.exploration-search label:first-child{flex:1;min-width:180px}.exploration-search input,.exploration-search select{height:38px;border:1px solid #cedacf;border-radius:6px;background:#fff;padding:5px 10px;color:#254532;width:100%}.exploration-search select{max-width:190px}.exploration-coverage,.exploration-order{font-size:12px;color:#6c7d71;margin:6px 0}.exploration-order{margin-bottom:17px}.exploration-save{flex:none;font-size:12px!important}.exploration-pagination{display:flex;justify-content:center;align-items:center;gap:13px;margin:22px 0}.exploration-pagination span{font-size:12px;color:#66766a}.exploration-state{padding:25px 0;color:#677970;line-height:1.8}.exploration-error{padding:12px;border:1px solid #e4c1b4;background:#fff8f4;color:#923d2c;font-size:13px}.exploration-gaps{margin-top:20px;font-size:12px;color:#6e7c70}.exploration-gaps summary,.exploration-section summary{cursor:pointer;color:#41644d}.exploration-detail:focus{outline:none}.exploration-detail-nav{display:flex;align-items:center;gap:10px;margin:0 0 18px}.exploration-detail-nav small{margin-left:auto;color:#7b887e;font-size:11px}.exploration-detail-header{position:relative;padding:0 100px 18px 0;border-bottom:1px solid #d5e1d4}.exploration-detail-header small{color:#77877a;font-size:12px}.exploration-detail-header h2{font-size:26px;margin:6px 0}.exploration-detail-header p{font-size:13px;color:#746b50;line-height:1.75}.exploration-detail-header .exploration-save{position:absolute;top:0;right:0}.exploration-section{padding:21px 0;border-bottom:1px solid #e0e7dc}.exploration-section h3{font-size:17px;margin:0 0 12px;color:#234530}.exploration-explanation{font-size:12px;color:#6f7d71;line-height:1.8;margin:0 0 12px}.exploration-career+.exploration-career{margin-top:20px}.exploration-career h4{font-size:14px;margin:0 0 8px;color:#365944}.exploration-career h5{font-size:12px;font-weight:500;margin:12px 0 7px;color:#6d7f70}.exploration-school{margin:15px 0}.exploration-school>button{padding:3px 0;border:0;border-radius:0;background:transparent;font-weight:700}.exploration-school>span{display:block;font-size:12px;color:#6d7e71}.exploration-school>p{font-size:12px;color:#7b745c;margin:5px 0 10px}.exploration-detail-gaps{padding-left:20px;color:#746b51;font-size:12px;line-height:1.9}.exploration-next{font-size:13px;padding:12px;background:#f0f4eb;border-left:2px solid #668768;margin:14px 0 0}.exploration-note-editor label{display:block;font-size:12px;color:#667d6a}.exploration-note-editor textarea{width:100%;resize:vertical;margin-top:7px;padding:10px;border:1px solid #c6d6c6;border-radius:6px;background:#fff;color:#294b34;line-height:1.7}.exploration-note-editor form footer{display:flex;justify-content:space-between;align-items:center;margin-top:7px}.exploration-note-editor form footer small{color:#7c897d}.exploration-note-message{font-size:12px;color:#3b6747;margin-bottom:0}.exploration-detail-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}.exploration-detail-actions span{font-size:12px;color:#6d7d71}
@media(max-width:640px){.exploration-header{display:block}.exploration-header h2{font-size:21px}.exploration-collection{margin-top:12px}.exploration-search label{min-width:0;flex:1!important}.exploration-search label:first-child{flex-basis:100%!important}.exploration-search select{max-width:none}.exploration-detail-header{padding-right:86px}.exploration-detail-header h2{font-size:24px;overflow-wrap:anywhere}.exploration-pagination{gap:7px}.exploration-pagination span{font-size:11px}.exploration-detail-nav{flex-wrap:wrap}.exploration-detail-nav small{display:none}.exploration-detail-actions{display:grid}.exploration-search .exploration-directory-button{flex-basis:100%}}
</style>

<style scoped src="../exploration-cards.css"></style>
