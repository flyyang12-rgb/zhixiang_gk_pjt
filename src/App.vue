<script setup lang="ts">
import { computed, defineAsyncComponent, h, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import ProfessionDashboard from './components/ProfessionDashboard.vue'
import { createProfile, deleteProfile, downloadReport, getDataStatus, getProfile, getProfiles, type AdvisorFocus, type DataCoverage, type DataYearStatus, type ProfileInput, type StudentProfile } from './api'

function deferred(loader:()=>Promise<unknown>,label:string){
  return defineAsyncComponent({loader:loader as never,delay:120,loadingComponent:{render:()=>h('div',{class:'async-module-loading',role:'status'},`正在加载${label}…`)},errorComponent:{render:()=>h('div',{class:'async-module-loading error'},`${label}加载失败，请刷新重试。`)}})
}
const SchoolMap=deferred(()=>import('./components/SchoolMap.vue'),'院校地图')
const RecommendationView=deferred(()=>import('./components/RecommendationView.vue'),'候选方案')
const AdvisorChat=deferred(()=>import('./components/AdvisorChat.vue'),'规划顾问')
const SchoolDetailDrawer=deferred(()=>import('./components/SchoolDetailDrawer.vue'),'院校详情')
const DataQualityAdmin=deferred(()=>import('./components/DataQualityAdmin.vue'),'数据核验')

type View = 'profile' | 'dashboard' | 'recommendations' | 'advisor' | 'map' | 'admin'

const currentView = ref<View>(window.location.pathname==='/admin/data-quality'?'admin':'profile')
const profile = ref<StudentProfile | null>(null)
const isSaving = ref(false)
const isRestoring = ref(true)
const errorMessage = ref('')
const selectedSchoolId = ref<number|null>(null)
const advisorInitialPrompt = ref('')
const advisorInitialFocus = ref<AdvisorFocus|null>(null)
const advisorReturnFocus=ref<AdvisorFocus|null>(null)
const dashboardInitialMajorId=ref<number|null>(null)
const profileHistory = ref<StudentProfile[]>([])
const showHistory = ref(false)
const dataCoverage = ref<DataCoverage[]>([])
const dataYearStatus = ref<DataYearStatus[]>([])
const dataStatusState = ref<'loading'|'ready'|'error'>('loading')
let dataStatusRetry:ReturnType<typeof setTimeout>|undefined
const form = reactive<ProfileInput>({
  studentName: '',
  province: '河南',
  subjectGroup: '',
  selectedSubjects: [],
  score: null,
  provinceRank: null,
  planningMode: 'application',
})

const currentStep = computed(() => currentView.value === 'profile' ? 1 : currentView.value === 'map' ? 0 : 2)
const progress = computed(() => currentStep.value ? Math.round(currentStep.value / 2 * 100) : 0)
const visibleScore = computed(() => profile.value?.score ?? (form.planningMode === 'application' ? form.score : null))
const scoreDisplay = computed(() => visibleScore.value ?? '—')
const scoreDisplayLabel = computed(() => visibleScore.value == null ? '未记录成绩' : '分数坐标')
const currentSubjectGroup = computed(() => profile.value?.subjectGroup || form.subjectGroup)
const currentCoverage = computed(() => dataCoverage.value.find(item => item.province === (profile.value?.province || form.province) && item.subjectGroup === currentSubjectGroup.value))
const currentProvinceYearStatus = computed(() => dataYearStatus.value.filter(item => item.province === (profile.value?.province || form.province)))
const selectableSubjects = computed(() => form.province === '山东' ? ['物理','历史','化学','生物','政治','地理'] as const : ['化学','生物','政治','地理'] as const)

onMounted(async () => {
  if(currentView.value==='admin'){isRestoring.value=false;return}
  void refreshDataStatus()
  const currentId = localStorage.getItem('zhixiang.currentProfileId')
  if (currentId) {
    try {
      profile.value = await getProfile(currentId)
      localStorage.removeItem('zhixiang.currentView')
      localStorage.removeItem('zhixiang.currentPerspective')
      currentView.value = 'dashboard'
    } catch {
      localStorage.removeItem('zhixiang.currentProfileId')
    }
  }
  isRestoring.value = false
})
onUnmounted(()=>{if(dataStatusRetry)clearTimeout(dataStatusRetry)})

async function refreshDataStatus(){
  if(dataStatusRetry){clearTimeout(dataStatusRetry);dataStatusRetry=undefined}
  try{const status=await getDataStatus();dataCoverage.value=status.coverage;dataYearStatus.value=status.yearStatus;dataStatusState.value='ready'}
  catch{dataStatusState.value='error';dataStatusRetry=setTimeout(()=>void refreshDataStatus(),5000)}
}

async function submitProfile() {
  errorMessage.value = ''
  const expectedSubjectCount = form.province === '山东' ? 3 : 2
  if (!form.studentName.trim() || !form.subjectGroup || form.selectedSubjects.length !== expectedSubjectCount) {
    errorMessage.value = `请完成学生称呼、科类和${expectedSubjectCount}门选考科目。`
    return
  }
  if (form.planningMode === 'application' && !form.score) {
    errorMessage.value = '志愿填报模式请填写高考或模考分数。'
    return
  }

  isSaving.value = true
  try {
    const result = await createProfile({
      ...form,
      selectedSubjects: form.province === '山东' ? form.selectedSubjects : [form.subjectGroup === '物理类' ? '物理' : '历史', ...form.selectedSubjects],
      studentName: form.studentName.trim(),
      score: form.planningMode === 'exploration' ? null : form.score,
      provinceRank: form.planningMode === 'exploration' ? null : form.provinceRank || null,
    })
    localStorage.setItem('zhixiang.currentProfileId', result.id)
    profile.value = await getProfile(result.id)
    await new Promise(resolve => setTimeout(resolve, 320))
    currentView.value = 'dashboard'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存失败，请稍后重试。'
  } finally {
    isSaving.value = false
  }
}

function toggleSubject(subject: typeof selectableSubjects.value[number]) {
  const limit = form.province === '山东' ? 3 : 2
  const index = form.selectedSubjects.indexOf(subject)
  if (index >= 0) form.selectedSubjects.splice(index, 1)
  else if (form.selectedSubjects.length < limit) form.selectedSubjects.push(subject)
}

function createAnotherProfile() {
  localStorage.removeItem('zhixiang.currentProfileId')
  profile.value = null
  Object.assign(form, { studentName: '', province: '河南', subjectGroup: '', selectedSubjects: [], score: null, provinceRank: null, planningMode: 'application' })
  currentView.value = 'profile'
}

async function openHistory() {
  const profiles = await getProfiles()
  profileHistory.value = profile.value
    ? [profile.value, ...profiles.filter(item => item.id !== profile.value?.id)]
    : profiles
  showHistory.value = true
}

async function switchProfile(selected: StudentProfile) {
  localStorage.setItem('zhixiang.currentProfileId', selected.id)
  localStorage.removeItem('zhixiang.currentView')
  profile.value = await getProfile(selected.id)
  currentView.value = 'dashboard'
  showHistory.value = false
  void refreshDataStatus()
}

async function deleteHistoryProfile(selected: StudentProfile) {
  const scoreDescription = selected.score == null ? '未记录分数' : `${selected.score} 分`
  const confirmed = window.confirm(`确定永久删除“${selected.studentName}（${scoreDescription}）”吗？\n\n关联的候选清单、收藏和顾问聊天也会一起删除，且无法恢复。`)
  if (!confirmed) return
  await deleteProfile(selected.id)
  profileHistory.value = profileHistory.value.filter(item => item.id !== selected.id)
  if (selected.id === profile.value?.id) {
    localStorage.removeItem('zhixiang.currentProfileId')
    localStorage.removeItem('zhixiang.currentView')
    localStorage.removeItem('zhixiang.currentPerspective')
    profile.value = null
    Object.assign(form, { studentName: '', province: '河南', subjectGroup: '', selectedSubjects: [], score: null, provinceRank: null, planningMode: 'application' })
    currentView.value = 'profile'
  }
  if (!profileHistory.value.length) showHistory.value = false
}

function openSchool(schoolId:number){selectedSchoolId.value=schoolId}
function askAdvisor(payload:{prompt:string;focus:AdvisorFocus}){advisorInitialPrompt.value=payload.prompt;advisorInitialFocus.value=payload.focus;advisorReturnFocus.value=payload.focus;selectedSchoolId.value=null;currentView.value='advisor'}
function askSchoolAdvisor(payload:{prompt:string;focus:AdvisorFocus}){advisorInitialPrompt.value=payload.prompt;advisorInitialFocus.value=payload.focus;advisorReturnFocus.value=payload.focus;selectedSchoolId.value=null;currentView.value='advisor'}
function openAdvisor(){advisorInitialPrompt.value='';advisorInitialFocus.value=null;advisorReturnFocus.value=null;currentView.value='advisor'}
async function returnFromAdvisor(currentFocus:AdvisorFocus|null){
  const focus=currentFocus??advisorReturnFocus.value
  dashboardInitialMajorId.value=focus?.type==='major'?focus.majorId:null
  currentView.value='dashboard'
  await nextTick()
  if(focus?.type==='school')selectedSchoolId.value=focus.schoolId
  advisorReturnFocus.value=null
}
</script>

<template>
  <DataQualityAdmin v-if="currentView==='admin'" />
  <div v-else class="app-shell">
    <aside class="rail">
      <div class="logo" aria-label="知向">知</div>
      <nav aria-label="工作台导航">
        <button class="rail-button" :class="{ active: currentView !== 'map' }" aria-label="志愿规划" @click="currentView = profile ? 'dashboard' : 'profile'">
          <svg viewBox="0 0 24 24"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 5h8M8 12h8M8 16h5"/></svg>
        </button>
        <button class="rail-button" :class="{ active: currentView === 'map' }" aria-label="院校地图" @click="currentView = 'map'">
          <svg viewBox="0 0 24 24"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/></svg>
        </button>
        <button v-if="profile" class="rail-button" :class="{ active: currentView === 'advisor' }" aria-label="规划顾问" @click="openAdvisor">
          <svg viewBox="0 0 24 24"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 5h8m-8 3h5"/></svg>
        </button>
      </nav>
      <div class="rail-footer">01</div>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <div class="wordmark"><strong>知向</strong><span>志愿规划工作台</span></div>
        <div class="topbar-actions">
          <button v-if="currentView === 'advisor'" class="history-trigger" @click="openHistory"><span>↻</span> 历史档案</button>
          <div class="save-state"><i></i>{{ profile ? '已保存到公开档案' : '公开共享模式' }}</div>
        </div>
        <Transition name="notice">
          <div v-if="currentView === 'advisor' && showHistory" class="history-popover topbar-history">
            <header><strong>公开历史档案</strong><button @click="showHistory = false">×</button></header>
            <p>所有访客都能查看、修改和永久删除</p>
            <div class="history-list">
              <div v-for="item in profileHistory" :key="item.id" :class="['history-item', { current: item.id === profile?.id }]">
                <button class="history-select" @click="switchProfile(item)">
                  <span><b>{{ item.studentName }}</b><small>{{ item.province }} · {{ item.subjectGroup }} · {{ new Date(item.updatedAt).toLocaleString('zh-CN') }}</small></span>
                  <strong>{{ item.score ?? '—' }}<small>{{ item.score == null ? '未记录' : '分' }}</small></strong>
                </button>
                <button class="history-delete" :aria-label="`删除 ${item.studentName} ${item.score == null ? '未记录分数' : `${item.score} 分`}档案`" title="永久删除" @click="deleteHistoryProfile(item)">删除</button>
              </div>
            </div>
          </div>
        </Transition>
      </header>

      <div class="workspace-body" :class="{ 'map-workspace': currentView === 'map', 'advisor-workspace': currentView === 'advisor', 'dashboard-workspace': currentView === 'dashboard' }">
        <aside v-if="currentView !== 'map' && currentView !== 'advisor'" class="steps-panel">
          <div class="plan-label">当前规划</div>
          <h1>{{ profile?.studentName || form.studentName || '新的学生档案' }}</h1>
          <p>{{ profile ? `${profile.province} · ${profile.subjectGroup}` : '从真实信息开始，一步一步找到更合适的方向。' }}</p>
          <button class="history-trigger" @click="openHistory"><span>↻</span> 历史档案</button>

          <Transition name="notice">
            <div v-if="showHistory" class="history-popover">
              <header><strong>公开历史档案</strong><button @click="showHistory = false">×</button></header>
              <p>所有访客都能查看、修改和永久删除</p>
              <div class="history-list">
                <div v-for="item in profileHistory" :key="item.id" :class="['history-item', { current: item.id === profile?.id }]">
                  <button class="history-select" @click="switchProfile(item)">
                    <span><b>{{ item.studentName }}</b><small>{{ item.province }} · {{ item.subjectGroup }} · {{ new Date(item.updatedAt).toLocaleString('zh-CN') }}</small></span>
                    <strong>{{ item.score ?? '—' }}<small>{{ item.score == null ? '未记录' : '分' }}</small></strong>
                  </button>
                  <button class="history-delete" :aria-label="`删除 ${item.studentName} ${item.score == null ? '未记录分数' : `${item.score} 分`}档案`" title="永久删除" @click="deleteHistoryProfile(item)">删除</button>
                </div>
              </div>
            </div>
          </Transition>

          <div class="progress-track"><span :style="{ width: `${progress}%` }"></span></div>
          <small>整体进度 {{ progress }}%</small>

          <ol class="steps">
            <li :class="{ active: currentStep === 1, done: currentStep > 1 }"><b>1</b><span>基础信息<small>建立学生档案</small></span></li>
            <li :class="{ active: currentStep === 2 }"><b>2</b><span>专业与学校<small>直接比较并查看解读</small></span></li>
          </ol>
        </aside>

        <section class="canvas" :class="{ restoring: isRestoring, 'map-canvas': currentView === 'map', 'advisor-canvas': currentView === 'advisor', 'dashboard-canvas': currentView === 'dashboard' }">
          <Transition name="panel" mode="out-in">
            <SchoolMap v-if="currentView === 'map'" key="map" @back="currentView = profile ? 'dashboard' : 'profile'" @school="openSchool" />
            <div v-else-if="isRestoring" key="loading" class="loading-panel">
              <span class="spinner"></span><p>正在恢复本地规划…</p>
            </div>

            <form v-else-if="currentView === 'profile'" key="profile" class="content-panel" @submit.prevent="submitProfile">
              <div class="content-head">
                <span class="kicker">STEP 01 · 基础信息</span>
                <h2>先建立一份学生档案</h2>
                <p>这些信息只保存在你的本地数据库，用于筛选专业方向；有可靠位次后再计算学校候选。</p>
              </div>

              <div class="form-grid">
                <fieldset class="mode-picker span-two">
                  <legend>当前规划阶段</legend>
                  <label :class="{ active: form.planningMode === 'exploration' }"><input v-model="form.planningMode" type="radio" value="exploration" /><span><b>目标探索</b><small>可先看专业；补充有效位次后自动推荐学校</small></span></label>
                  <label :class="{ active: form.planningMode === 'application' }"><input v-model="form.planningMode" type="radio" value="application" /><span><b>志愿填报</b><small>现在已有可靠位次，直接计算学校冲稳保</small></span></label>
                </fieldset>
                <label class="field span-two">
                  <span>学生称呼</span>
                  <input v-model="form.studentName" maxlength="32" placeholder="例如：小知" autocomplete="off" />
                  <small>报告和工作台中使用，不要求填写真实姓名</small>
                </label>
                <label class="field">
                  <span>考生省份</span>
                  <select v-model="form.province"><option>河南</option><option>山东</option><option>河北</option></select>
                </label>
                <div class="field span-two">
                  <span>{{ form.province === '山东' ? '选考科目（选择 3 门）' : '其余选考科目（选择 2 门）' }}</span>
                  <div class="subject-picker">
                    <button v-for="subject in selectableSubjects" :key="subject" type="button" :class="{ active: form.selectedSubjects.includes(subject) }" @click="toggleSubject(subject)">{{ subject }}</button>
                  </div>
                  <small>用于先过滤不符合选科要求的专业和专业组</small>
                </div>
                <label class="field">
                  <span>科类 / 选科模式</span>
                  <select v-model="form.subjectGroup">
                    <option value="" disabled>请选择</option>
                    <option v-if="form.province === '山东'">综合改革</option>
                    <template v-else><option>物理类</option><option>历史类</option></template>
                  </select>
                </label>
                <section v-if="form.planningMode === 'exploration'" class="exploration-note" role="note" aria-label="目标探索说明">
                  <span>无需分数和位次</span>
                  <p>先根据省份、科类和选科了解专业与可核验学校。以后记录联考或统考位次，学校冲稳保会自动出现。</p>
                </section>
                <label v-if="form.planningMode === 'application'" class="field">
                  <span>高考 / 模考分数</span>
                  <div class="suffix-input"><input v-model.number="form.score" type="number" min="100" max="750" placeholder="612" /><i>分</i></div>
                </label>
                <label v-if="form.planningMode === 'application'" class="field">
                  <span>全省位次 <em>选填</em></span>
                  <div class="suffix-input"><input v-model.number="form.provinceRank" type="number" min="1" placeholder="18500" /><i>名</i></div>
                  <small>未填写时不猜学校；以后记录联考或统考全省位次会自动开启学校推荐</small>
                </label>
              </div>

              <Transition name="notice">
                <div v-if="errorMessage" class="error-notice" role="alert">{{ errorMessage }}</div>
              </Transition>

              <footer class="form-footer">
                <p><span>隐私说明</span> 数据不会离开这台电脑</p>
                <button class="primary-action" :disabled="isSaving">
                  <span v-if="isSaving" class="button-spinner"></span>
                  {{ isSaving ? '正在建立档案…' : '保存并开始分析' }}
                  <b v-if="!isSaving">→</b>
                </button>
              </footer>
            </form>

            <RecommendationView
              v-else-if="currentView === 'recommendations' && profile"
              key="recommendations"
              :profile-id="profile.id"
              :student-name="profile.studentName"
              @school="openSchool"
              @advisor="openAdvisor"
              @rank-updated="(value:number) => { if (profile) profile.provinceRank = value }"
            />

            <ProfessionDashboard
              v-else-if="currentView === 'dashboard' && profile"
              key="profession-dashboard"
              :profile-id="profile.id"
              :student-name="profile.studentName"
              :initial-major-id="dashboardInitialMajorId"
              @school="openSchool"
              @advisor="askAdvisor"
            />

            <AdvisorChat
              v-else-if="currentView === 'advisor' && profile"
              key="advisor"
              :profile-id="profile.id"
              :student-name="profile.studentName"
              :province="profile.province"
              :subject-group="profile.subjectGroup"
              :province-rank="profile.provinceRank"
              :initial-prompt="advisorInitialPrompt"
              :initial-focus="advisorInitialFocus"
              @back="returnFromAdvisor"
              @recommendations="currentView = 'dashboard'"
              @report="downloadReport(profile.id)"
            />

          </Transition>
        </section>

        <aside v-if="currentView !== 'map' && currentView !== 'advisor'" class="insight-panel">
          <div class="score-orbit"><span>{{ scoreDisplay }}</span><small>{{ scoreDisplayLabel }}</small></div>
          <div class="insight-card">
            <span>{{ visibleScore == null ? '暂时没有成绩也能开始' : '为什么先填位次？' }}</span>
            <p>{{ visibleScore == null ? '目标探索先看专业与就业证据，不猜分数，也不生成冲稳保。' : '不同年份的试卷难度不同。位次比裸分更适合比较历年录取情况。' }}</p>
          </div>
          <div class="data-source"><i></i><span>数据模式<strong>Supabase 公开共享</strong></span></div>
          <div class="data-coverage">
            <span>当前科类可比数据</span><strong v-if="dataStatusState==='loading'">正在读取…</strong><strong v-else-if="dataStatusState==='error'">数据状态暂不可用 <button class="coverage-retry" @click="refreshDataStatus">重试</button></strong><strong v-else-if="!currentSubjectGroup">选择科类后查看可比数据</strong><strong v-else-if="currentCoverage">{{ currentCoverage.years.join(' / ') }} · {{ currentCoverage.recordCount.toLocaleString() }} 条</strong><strong v-else>尚未覆盖当前科类</strong>
            <div class="year-status-list">
              <a v-for="item in currentProvinceYearStatus" :key="item.year" :href="item.sourceUrl" target="_blank" rel="noreferrer">
                <b>{{ item.year }}</b><span>{{ item.recordCount.toLocaleString() }} 条 · {{ item.subjectGroups.join('/') }}</span><small>{{ item.publisher }} · 更新 {{ new Date(item.updatedAt).toLocaleDateString('zh-CN') }}</small>
              </a>
            </div>
          </div>
        </aside>
      </div>
    </main>
    <SchoolDetailDrawer v-if="selectedSchoolId" :school-id="selectedSchoolId" :profile-id="profile?.id" @close="selectedSchoolId=null" @advisor="askSchoolAdvisor" />
  </div>
</template>
