<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { addScoreSnapshot, deleteScoreSnapshot, getProfessionDashboard, getSchoolComparisonAnalysis, getSchoolDetail, removeDashboardItem, saveDashboardItem, updateDashboardItemNote, type AdvisorFocus, type ProfessionCard, type ProfessionDashboard, type SavedItem, type SchoolDetail } from '../api'
import { buildProfessionInsights } from '../profession-insights'
import { describeScoreTrend } from '../score-trend'
import FamilyBrief from './FamilyBrief.vue'

const props=defineProps<{profileId:string;studentName:string;initialMajorId?:number|null}>()
const emit=defineEmits<{school:[number];advisor:[{prompt:string;focus:AdvisorFocus}]}>()
const dashboard=ref<ProfessionDashboard|null>(null),loading=ref(true),error=ref(''),expanded=ref<number|null>(null)
const detailPanel=ref<HTMLElement|null>(null)
const savingKeys=ref(new Set<string>()),actionMessage=ref('')
const dialogMode=ref<'confirmation'|'collection'|null>(null)
const collectionView=ref<'list'|'compare'>('list'),compareSelection=ref<number[]>([]),comparisonDetails=ref<SchoolDetail[]>([]),compareLoading=ref(false),compareError=ref('')
const comparisonAnalysis=ref(''),analysisMode=ref<'ai'|'local'|null>(null),analysisLoading=ref(false),analysisError=ref('')
const lastSaved=ref<{itemType:'major'|'school';itemName:string}|null>(null)
const showScoreForm=ref(false),scoreSaving=ref(false),scoreError=ref('')
const scoreForm=ref({examName:'',examDate:new Date().toISOString().slice(0,10),score:'',provinceRank:'',note:''})
const familyBriefOpen=ref(false),familyDetails=ref<SchoolDetail[]>([]),familyLoading=ref(false),briefButton=ref<HTMLButtonElement|null>(null)
const editingNoteKey=ref<string|null>(null),noteDraft=ref(''),noteSaving=ref(false)
const bands=['优先了解','值得比较','谨慎报考'] as const
const risks=['冲','稳','保'] as const
const cardsByBand=computed(()=>Object.fromEntries(bands.map(band=>[band,dashboard.value?.cards.filter(card=>card.band===band)??[]])) as Record<typeof bands[number],ProfessionCard[]>)
const candidatesByRisk=computed(()=>Object.fromEntries(risks.map(risk=>[risk,dashboard.value?.schoolCandidates.filter(candidate=>candidate.risk===risk)??[]])))
const savedMajors=computed(()=>(dashboard.value?.savedItems??[]).filter(item=>item.itemType==='major'&&item.state==='saved').map(withItemName))
const savedSchools=computed(()=>(dashboard.value?.savedItems??[]).filter(item=>item.itemType==='school'&&item.state==='target').map(withItemName))
const collectionCount=computed(()=>savedMajors.value.length+savedSchools.value.length)
const activeCard=computed(()=>dashboard.value?.cards.find(card=>card.id===expanded.value)??null)
const activeBandCards=computed(()=>activeCard.value?cardsByBand.value[activeCard.value.band]:[])
const activeCardIndex=computed(()=>activeBandCards.value.findIndex(card=>card.id===expanded.value))
const activePosition=computed(()=>activeCardIndex.value<0?0:activeCardIndex.value+1)
const scoreTrend=computed(()=>describeScoreTrend((dashboard.value?.scoreSnapshots??[]).map(item=>({score:item.score,provinceRank:item.provinceRank}))))
const planningStabilityLabels={single:'单次参考',preliminary:'初步参考',stable:'相对稳定',moderate:'有一定波动',volatile:'波动较大'} as const
const planningSummary=computed(()=>{const coordinate=dashboard.value?.planningCoordinate;if(!coordinate?.rank)return '还没有可用的全省位次';return `推荐使用综合规划位次 ${coordinate.rank.toLocaleString()} · ${coordinate.sampleCount} 次有效位次 · ${planningStabilityLabels[coordinate.stability]}`})

onMounted(()=>{load();window.addEventListener('keydown',handleWindowKeys)})
onBeforeUnmount(()=>window.removeEventListener('keydown',handleWindowKeys))
async function load(){loading.value=true;error.value='';try{dashboard.value=await getProfessionDashboard(props.profileId);expanded.value=props.initialMajorId??null}catch(value){error.value=value instanceof Error?value.message:'专业就业数据加载失败'}finally{loading.value=false}}
async function openDetail(cardId:number){expanded.value=cardId;await nextTick()}
function focusDetail(){detailPanel.value?.focus({preventScroll:true})}
async function closeDetail(){expanded.value=null;await nextTick()}
async function moveDetail(step:number){
  if(activeCardIndex.value<0||!activeBandCards.value.length)return
  const next=(activeCardIndex.value+step+activeBandCards.value.length)%activeBandCards.value.length
  await openDetail(activeBandCards.value[next].id)
}
function handleDetailKeys(event:KeyboardEvent){
  if(!activeCard.value||dialogMode.value)return
  if(event.key==='Escape'){event.preventDefault();closeDetail()}
  if(event.key==='ArrowLeft'){event.preventDefault();moveDetail(-1)}
  if(event.key==='ArrowRight'){event.preventDefault();moveDetail(1)}
}
function handleWindowKeys(event:KeyboardEvent){
  if(document.querySelector('.school-detail-drawer'))return
  handleDetailKeys(event)
}
function saved(itemType:'major'|'school',itemId:number,state?:SavedItem['state']){return dashboard.value?.savedItems.find(item=>item.itemType===itemType&&item.itemId===itemId&&(!state||item.state===state))}
function resolveItemName(itemType:'major'|'school',itemId:number){
  if(itemType==='major')return dashboard.value?.cards.find(card=>card.id===itemId)?.name??'专业方向'
  return dashboard.value?.schoolCandidates.find(candidate=>candidate.schoolId===itemId)?.schoolName
    ??dashboard.value?.cards.flatMap(card=>card.schools).find(school=>school.id===itemId)?.name
    ??'目标院校'
}
function withItemName(item:SavedItem){return {...item,itemName:item.itemName||resolveItemName(item.itemType,item.itemId)}}
async function toggle(itemType:'major'|'school',itemId:number,state:SavedItem['state']){
  if(!dashboard.value)return
  const key=`${itemType}-${itemId}`
  if(savingKeys.value.has(key))return
  const existing=dashboard.value.savedItems.find(item=>item.itemType===itemType&&item.itemId===itemId)
  savingKeys.value=new Set(savingKeys.value).add(key)
  actionMessage.value=''
  try{
    if(existing?.state===state){
      await removeDashboardItem(props.profileId,itemType,itemId)
      dashboard.value.savedItems=dashboard.value.savedItems.filter(item=>item!==existing)
      actionMessage.value=itemType==='major'?'已取消收藏专业':'已移出目标院校'
    }else{
      const value=await saveDashboardItem(props.profileId,{itemType,itemId,state})
      const itemName=resolveItemName(itemType,itemId)
      dashboard.value.savedItems=dashboard.value.savedItems.filter(item=>!(item.itemType===itemType&&item.itemId===itemId))
      dashboard.value.savedItems.push({...value,note:value.note===undefined?existing?.note??null:value.note,itemName})
      if(state==='saved'||state==='target'){
        lastSaved.value={itemType,itemName}
        dialogMode.value='confirmation'
      }else actionMessage.value='已排除该专业'
    }
  }catch(value){actionMessage.value=value instanceof Error?value.message:'保存失败，请稍后重试'}
  finally{const next=new Set(savingKeys.value);next.delete(key);savingKeys.value=next}
}
function saving(itemType:'major'|'school',itemId:number){return savingKeys.value.has(`${itemType}-${itemId}`)}
function askMajor(card:ProfessionCard){emit('advisor',{prompt:`请结合当前档案，用简单的话解释${card.name}：为什么放在“${card.band}”、毕业后能做什么、报考前要查清什么？`,focus:{type:'major',majorId:card.id,majorName:card.name}})}
function openCollection(){dialogMode.value='collection';collectionView.value='list';compareSelection.value=[];comparisonDetails.value=[];compareError.value='';comparisonAnalysis.value='';analysisError.value=''}
function toggleCompareSelection(schoolId:number){if(compareSelection.value.includes(schoolId))compareSelection.value=compareSelection.value.filter(id=>id!==schoolId);else if(compareSelection.value.length<4)compareSelection.value=[...compareSelection.value,schoolId]}
async function startComparison(){if(compareSelection.value.length<2||compareSelection.value.length>4)return;compareLoading.value=true;compareError.value='';comparisonAnalysis.value='';analysisError.value='';try{comparisonDetails.value=await Promise.all(compareSelection.value.map(id=>getSchoolDetail(id,props.profileId)));collectionView.value='compare';void loadComparisonAnalysis()}catch(value){compareError.value=value instanceof Error?value.message:'院校比较加载失败'}finally{compareLoading.value=false}}
async function openFamilyBrief(){if(compareSelection.value.length<1||compareSelection.value.length>4)return;familyLoading.value=true;compareError.value='';try{familyDetails.value=await Promise.all(compareSelection.value.map(id=>getSchoolDetail(id,props.profileId)));familyBriefOpen.value=true}catch(value){compareError.value=value instanceof Error?value.message:'家庭简报加载失败'}finally{familyLoading.value=false}}
async function closeFamilyBrief(){familyBriefOpen.value=false;await nextTick();briefButton.value?.focus()}
async function loadComparisonAnalysis(){if(compareSelection.value.length<2)return;analysisLoading.value=true;analysisError.value='';analysisMode.value=null;try{const result=await getSchoolComparisonAnalysis(props.profileId,compareSelection.value);comparisonAnalysis.value=result.content;analysisMode.value=result.mode}catch(value){analysisError.value=value instanceof Error?value.message:'对比分析暂时无法生成'}finally{analysisLoading.value=false}}
function currentAdmission(detail:SchoolDetail){return detail.admissionContext?.records[0]??null}
function subjectSummary(detail:SchoolDetail){return [...new Set((detail.admissionContext?.records??[]).map(record=>record.subjectRequirement||'不限'))].slice(0,3).join(' / ')||'暂无记录'}
function dataGaps(detail:SchoolDetail){const gaps:string[]=[];if(!detail.admissionContext?.records.length)gaps.push('当前档案无可比招生记录');if(!detail.featuredMajors.length)gaps.push('官方优势专业暂无核验，已提供推荐关注');if(!detail.school.officialUrl)gaps.push('学校官网待核验');if(!detail.school.admissionsUrl)gaps.push('招生官网待核验');return gaps.length?gaps:['核心信息已核验，仍需复核当年招生章程']}
async function removeCompared(detail:SchoolDetail){await toggle('school',detail.school.id,'target');comparisonDetails.value=comparisonDetails.value.filter(item=>item.school.id!==detail.school.id);compareSelection.value=compareSelection.value.filter(id=>id!==detail.school.id);if(comparisonDetails.value.length<2)collectionView.value='list';else void loadComparisonAnalysis()}
function openNoteEditor(item:SavedItem){editingNoteKey.value=`${item.itemType}-${item.itemId}`;noteDraft.value=item.note??''}
function closeNoteEditor(){editingNoteKey.value=null;noteDraft.value=''}
async function saveEditedNote(item:SavedItem){if(!dashboard.value)return;noteSaving.value=true;const note=noteDraft.value.trim()||null;try{await updateDashboardItemNote(props.profileId,item.itemType,item.itemId,note);const savedItem=dashboard.value.savedItems.find(value=>value.itemType===item.itemType&&value.itemId===item.itemId);if(savedItem)savedItem.note=note;actionMessage.value='家庭讨论备注已保存';closeNoteEditor()}catch(value){actionMessage.value=value instanceof Error?value.message:'备注保存失败'}finally{noteSaving.value=false}}
function applyFamilyBriefNote(schoolId:number,note:string|null){const savedItem=dashboard.value?.savedItems.find(item=>item.itemType==='school'&&item.itemId===schoolId);if(savedItem)savedItem.note=note;actionMessage.value='家庭讨论备注已保存'}
async function submitScore(){scoreSaving.value=true;scoreError.value='';try{await addScoreSnapshot(props.profileId,{examName:scoreForm.value.examName,examDate:scoreForm.value.examDate,score:Number(scoreForm.value.score),provinceRank:scoreForm.value.provinceRank?Number(scoreForm.value.provinceRank):null,note:scoreForm.value.note||null});showScoreForm.value=false;scoreForm.value={examName:'',examDate:new Date().toISOString().slice(0,10),score:'',provinceRank:'',note:''};await load()}catch(value){scoreError.value=value instanceof Error?value.message:'模考坐标保存失败'}finally{scoreSaving.value=false}}
async function removeScore(snapshotId:number){try{await deleteScoreSnapshot(props.profileId,snapshotId);await load()}catch(value){scoreError.value=value instanceof Error?value.message:'模考记录删除失败'}}
const factorLabels={coverage:'最近招聘机会多不多',directEntry:'本科毕业能不能直接做',schoolAccess:'按你位次有多少学校可选',stability:'近期需求稳不稳',outlook:'未来发展有没有官方依据'}
</script>

<template>
  <div class="profession-dashboard">
    <p v-if="actionMessage" class="save-feedback" role="status">{{actionMessage}}</p>
    <div v-if="loading" class="loading-panel"><span class="spinner"></span><p>正在同步专业与就业数据…</p></div>
    <div v-else-if="error" class="flow-error"><p>{{error}}</p><button @click="load">重新加载</button></div>
    <div v-else-if="!dashboard?.cards.length" class="empty-state"><strong>当前没有满足硬条件的专业</strong><p>请核对具体选科、位次和本省专业招生数据；系统不会用学校线或模拟专业凑数。</p></div>
    <template v-else>
      <section class="score-timeline">
        <header><div><span class="kicker">模考坐标</span><h3>{{scoreTrend}}</h3><strong class="planning-coordinate">{{planningSummary}}</strong><p>最近最多 5 次全省位次取中位数，减少单次超常或失常的影响；不平均分数，不预测高考。</p></div><button @click="showScoreForm=!showScoreForm">{{showScoreForm?'收起':'记一次模考'}}</button></header>
        <form v-if="showScoreForm" class="score-form" @submit.prevent="submitScore"><label>考试名称<input v-model="scoreForm.examName" required maxlength="64" placeholder="例如：高二期末"></label><label>日期<input v-model="scoreForm.examDate" required type="date"></label><label>分数<input v-model="scoreForm.score" required type="number" min="100" max="750"></label><label>全省位次（联考/统考）<input v-model="scoreForm.provinceRank" type="number" min="1" placeholder="校内排名不要填"></label><label class="score-note">备注<input v-model="scoreForm.note" maxlength="200" placeholder="本次考试范围或异常情况"></label><button :disabled="scoreSaving">{{scoreSaving?'保存中…':'保存为当前坐标'}}</button></form>
        <p v-if="scoreError" class="comparison-error" role="alert">{{scoreError}}</p>
        <ol><li v-for="snapshot in dashboard.scoreSnapshots" :key="snapshot.id"><span>{{snapshot.examDate}} · {{snapshot.examName}}</span><b>{{snapshot.score??'—'}} 分<template v-if="snapshot.provinceRank"> · 位次 {{snapshot.provinceRank.toLocaleString()}}</template></b><em v-if="snapshot.isCurrent">当前坐标</em><button v-else @click="removeScore(snapshot.id)">删除</button></li></ol>
      </section>
      <section v-if="dashboard?.mode==='application'" class="admission-layer">
        <header><span class="section-number">01</span><div><span class="kicker">学校与专业组参考</span><h3>先看位次可达，再核对组内专业</h3><p>{{dashboard.admissionEvidence.note}}</p></div><strong>{{dashboard.admissionEvidence.confidence}}置信度<small>{{dashboard.admissionEvidence.years.join(' / ')||'暂无可比年份'}}</small></strong></header>
        <div v-if="dashboard.schoolCandidates.length" class="admission-risk-grid">
          <div v-for="risk in risks" :key="risk" class="admission-risk-column"><h4>{{risk}} · 最多 2 所</h4><article v-for="candidate in candidatesByRisk[risk]" :key="candidate.unitId"><span :class="['school-risk',risk]">{{risk}}</span><div><button class="school-title-link" type="button" @click="emit('school',candidate.schoolId)">{{candidate.schoolName}} <span>查看详情 →</span></button><small>{{candidate.city}} · {{candidate.level}} · {{candidate.confidence}}置信度</small><p>{{candidate.unitName}}<template v-if="candidate.subjectRequirement"> · 选科 {{candidate.subjectRequirement}}</template></p><p>参考最低位次 {{candidate.referenceRank.toLocaleString() }} · {{candidate.dataYears.join(' / ')}}</p><nav><a :href="candidate.officialUrl" target="_blank" rel="noreferrer">学校官网 ↗</a><a :href="candidate.admissionsUrl" target="_blank" rel="noreferrer">本科招生网 ↗</a><a :href="candidate.sourceUrl" target="_blank" rel="noreferrer">投档来源 ↗</a></nav></div><button :class="{saved:saved('school',candidate.schoolId,'target')}" :disabled="saving('school',candidate.schoolId)" @click="toggle('school',candidate.schoolId,'target')">{{saving('school',candidate.schoolId)?'保存中…':saved('school',candidate.schoolId,'target')?'★ 已收藏':'☆ 收藏学校'}}</button></article><p v-if="!candidatesByRisk[risk].length" class="no-school">当前没有满足该档位且链接已核验的候选，不凑数。</p></div>
        </div>
        <p v-else class="no-school">当前没有满足位次、选科和链接核验条件的院校专业组。</p>
      </section>
      <section v-else class="school-recommendation-empty">
        <span class="section-number">01</span><div><span class="kicker">学校推荐待开启</span><h3>记一次全省位次，学校范围自动出现</h3><p>请填写可比联考或统考的全省位次。只有分数或校内排名不能用来判断冲稳保，系统不会硬猜学校。</p></div><button type="button" @click="showScoreForm=true">记录含位次的模考</button>
      </section>
      <header class="major-section-head"><span class="section-number">{{dashboard.mode==='application'?'02':'01'}}</span><div><span class="kicker">专业怎么选</span><h3>{{dashboard.majorPool.displayedCount}} 个已审核专业，分 3 组比较</h3><p>结合近期就业、可达院校和有来源的未来发展证据；当前证据池不是全部本科专业。</p></div><button class="collection-entry" :aria-label="`打开我的收藏，共 ${collectionCount} 项`" @click="openCollection"><span>我的收藏</span><b>{{collectionCount}}</b></button></header>
      <section v-if="dashboard.dataGaps.length" class="dashboard-data-gaps" aria-label="当前数据缺口"><strong>当前数据缺口</strong><ul><li v-for="gap in dashboard.dataGaps" :key="gap">{{gap}}</li></ul></section>
      <Transition name="profession-view" mode="out-in" @after-enter="focusDetail">
      <div v-if="!activeCard" key="profession-list" class="profession-bands">
      <section v-for="band in bands" :key="band" :class="['profession-band',band]">
        <header><div><span>{{band}}</span><p>{{band==='优先了解'?'证据相对完整，建议先看':band==='值得比较'?'方向可行，但需要比较门槛':'热门但存在明显门槛或证据不足'}}</p></div><b>{{cardsByBand[band].length}} 个专业</b></header>
        <article v-for="card in cardsByBand[band]" :key="card.id" :class="['profession-card',{excluded:saved('major',card.id,'excluded')}]">
          <div class="card-top"><button class="card-summary" :aria-label="`查看 ${card.name} 详情`" @click="openDetail(card.id)"><span class="major-code">{{card.code}}</span><div><small>{{card.category}} · 资料可靠程度：{{card.confidence}} · 资料完整度 {{card.evidenceCoverage}}%</small><h3>{{card.name}}</h3><p v-if="dashboard.employment.usable">最近 30 天，全国 {{card.provinceCount}} 个地区共收集到 {{card.jobCount.toLocaleString()}} 个不重复岗位</p><p v-else>近期招聘样本已过期或来源不足，暂不参与排序</p></div><strong>{{card.totalScore??'—'}}<small>{{card.totalScore==null?'暂不评分':'综合参考分'}}</small></strong><i>查看详情 <b>→</b></i></button><button class="major-save" :class="{saved:saved('major',card.id,'saved')}" :disabled="saving('major',card.id)" @click="toggle('major',card.id,'saved')">{{saving('major',card.id)?'…':saved('major',card.id,'saved')?'★ 已收藏':'☆ 收藏专业'}}</button></div>
          <div v-if="card.schools.length" class="major-school-preview"><span>可核验学校 {{card.schools.length}} 所</span><div><button v-for="school in card.schools.slice(0,2)" :key="school.id" type="button" @click="emit('school',school.id)"><em v-if="school.risk" :class="['school-risk',school.risk]">{{school.risk}}</em><b>{{school.name}}</b><small>查看学校 →</small></button></div></div>
        </article>
      </section>
      </div>
      <article v-else ref="detailPanel" :key="`profession-detail-${activeCard.id}`" class="profession-focus-detail" tabindex="-1" :aria-label="`${activeCard.name}专业详情`">
        <nav class="profession-focus-nav" aria-label="专业详情导航">
          <button class="focus-back" type="button" @click="closeDetail">← 返回专业列表</button>
          <span><b>{{activeCard.band}}</b>{{activePosition}} / {{activeBandCards.length}}</span>
          <div><button type="button" aria-label="上一个专业" @click="moveDetail(-1)">←</button><button type="button" aria-label="下一个专业" @click="moveDetail(1)">→</button><small>方向键切换 · Esc 返回</small></div>
        </nav>
        <header class="profession-focus-hero">
          <div><span class="focus-breadcrumb">专业了解卡 · {{activeCard.band}}</span><small>{{activeCard.code}} · {{activeCard.category}} · 资料可靠程度：{{activeCard.confidence}}</small><h3>{{activeCard.name}}</h3><p v-if="dashboard.employment.usable">最近 30 天，全国 {{activeCard.provinceCount}} 个地区共收集到 {{activeCard.jobCount.toLocaleString()}} 个不重复岗位 · 资料完整度 {{activeCard.evidenceCoverage}}%</p><p v-else>近期招聘样本暂不可用 · 资料完整度 {{activeCard.evidenceCoverage}}%</p></div>
          <div class="focus-score"><strong>{{activeCard.totalScore??'—'}}</strong><span>{{activeCard.totalScore==null?'暂不评分':'综合参考分'}}</span></div>
          <button class="focus-save" :class="{saved:saved('major',activeCard.id,'saved')}" :disabled="saving('major',activeCard.id)" @click="toggle('major',activeCard.id,'saved')">{{saving('major',activeCard.id)?'保存中…':saved('major',activeCard.id,'saved')?'★ 已收藏':'☆ 收藏专业'}}</button>
        </header>
        <div class="card-detail">
          <div class="profession-insights"><article v-for="(item,index) in buildProfessionInsights(activeCard)" :key="item.label"><b>0{{index+1}}</b><div><strong>{{item.label}}</strong><p>{{item.text}}</p></div></article></div>
          <div class="factor-grid"><div v-for="(factor,key) in activeCard.factors" :key="key"><span>{{factorLabels[key as keyof typeof factorLabels]}} · 占 {{factor.weight}} 分</span><b>{{factor.value??'—'}}</b><small>{{factor.evidence}}</small><a v-if="factor.reference" :href="factor.reference.sourceUrl" target="_blank" rel="noreferrer">{{factor.reference.publisher}} · {{factor.reference.sourceYear}} · 查看来源 ↗</a></div></div>
          <div class="job-directions"><h4>毕业后常见的 3 条路</h4><div><article v-for="job in activeCard.jobs" :key="job.id"><span>{{job.employmentCategory}}</span><b>{{job.name}}</b><small>{{job.directEntry?'本科毕业后可以尝试':job.requiresPostgraduate?'多数情况要继续读研':'还有其他入行要求'}}{{job.requiresCertificate?' · 还要考证':''}}</small></article></div></div>
          <div class="school-evidence"><h4>{{dashboard.mode==='application'?'哪些学校有明确的招生记录':'哪些学校有可查的招生资料'}}</h4><div v-if="activeCard.schools.length" class="school-evidence-list"><article v-for="school in activeCard.schools" :key="school.id"><span v-if="school.risk" :class="['school-risk',school.risk]">{{school.risk}}</span><div><button class="school-title-link" type="button" @click="emit('school',school.id)">{{school.name}} <span>查看详情 →</span></button><small>{{school.city}} · {{school.level}}<template v-if="school.medianRank"> · 近年参考位次 {{school.medianRank.toLocaleString()}}</template><template v-else-if="school.evidenceYears"> · 有 {{school.evidenceYears}} 年该专业招生记录</template></small><p v-if="school.programName">{{school.programName}} · {{school.years?.join(' / ')}}</p><nav><a v-if="school.officialUrl" :href="school.officialUrl" target="_blank" rel="noreferrer">学校官网 ↗</a><a v-if="school.admissionsUrl" :href="school.admissionsUrl" target="_blank" rel="noreferrer">招生官网 ↗</a><em v-else>招生官网待核对</em><a v-if="school.linksSourceUrl" :href="school.linksSourceUrl" target="_blank" rel="noreferrer">查看资料来源 ↗</a></nav></div><button :class="{saved:saved('school',school.id,'target')}" :disabled="saving('school',school.id)" @click="toggle('school',school.id,'target')">{{saving('school',school.id)?'保存中…':saved('school',school.id,'target')?'★ 已收藏':'☆ 收藏学校'}}</button></article></div><p v-else-if="activeCard.schoolMatchStatus==='group_only'" class="no-school">现在只查到这个学校专业组的投档线，还不能确定组里一定有这个专业。请先参考上方的学校和专业组信息。</p><p v-else class="no-school">现在还没查到经过核对的该专业招生记录，所以先不推测学校。</p></div>
          <footer><button class="major-advisor" @click="askMajor(activeCard)">问顾问 →</button><button class="exclude" :disabled="saving('major',activeCard.id)" @click="toggle('major',activeCard.id,'excluded')">{{saved('major',activeCard.id,'excluded')?'恢复专业':'排除专业'}}</button></footer>
        </div>
      </article>
      </Transition>
    </template>
  <Teleport to="body">
    <Transition name="collection-dialog">
      <div v-if="dialogMode" class="collection-backdrop" @click.self="dialogMode=null">
        <section class="collection-dialog" role="dialog" aria-modal="true" :aria-label="dialogMode==='confirmation'?'收藏成功':'我的收藏'">
          <button class="collection-close" aria-label="关闭收藏弹窗" @click="dialogMode=null">×</button>
          <template v-if="dialogMode==='confirmation'">
            <span class="collection-stamp">收藏成功</span>
            <small>{{lastSaved?.itemType==='major'?'专业方向':'目标院校'}}</small>
            <h3>{{lastSaved?.itemName}}</h3>
            <p>已保存到“{{studentName}} 的收藏”。这是公开档案，所有访客都能查看、修改和删除。</p>
            <blockquote>以梦为马<span>·</span>不负韶华</blockquote>
            <div class="collection-totals"><span><b>{{savedMajors.length}}</b>个专业</span><i></i><span><b>{{savedSchools.length}}</b>所学校</span></div>
            <footer><button class="collection-secondary" @click="dialogMode=null">继续比较</button><button class="collection-primary" @click="openCollection">查看我的收藏 →</button></footer>
          </template>
          <template v-else>
            <template v-if="collectionView==='list'">
              <span class="collection-eyebrow">当前学生档案</span><h3>{{studentName}} 的收藏</h3><p>选择 2—4 所目标院校做一次紧凑比较，也可以直接进入详情。</p>
              <div class="collection-lists">
                <section><header><span>专业方向</span><b>{{savedMajors.length}}</b></header><ul v-if="savedMajors.length"><li v-for="item in savedMajors" :key="`major-${item.itemId}`" class="collection-note-row"><div class="collection-item-main"><span>{{item.itemName}}</span><button :disabled="saving('major',item.itemId)" @click="toggle('major',item.itemId,'saved')">移除</button></div><div class="collection-note-summary"><p>{{item.note||'未添加家庭备注'}}</p><button :aria-label="`${item.note?'编辑':'添加'} ${item.itemName} 家庭备注`" @click="openNoteEditor(item)">{{item.note?'编辑备注':'添加备注'}}</button></div><div v-if="editingNoteKey===`major-${item.itemId}`" class="collection-note-editor"><label>家庭讨论备注<textarea v-model="noteDraft" maxlength="500" :aria-label="`${item.itemName} 家庭讨论备注`" placeholder="写下已经讨论出的结论，或还要核验的事。"></textarea></label><small>{{noteDraft.length}} / 500</small><div><button @click="closeNoteEditor">取消</button><button :disabled="noteSaving" @click="saveEditedNote(item)">{{noteSaving?'保存中…':'保存备注'}}</button></div></div></li></ul><p v-else>还没有收藏专业</p></section>
                <section><header><span>目标院校</span><b>{{savedSchools.length}}</b></header><ul v-if="savedSchools.length"><li v-for="item in savedSchools" :key="`school-${item.itemId}`" class="collection-school-row"><div class="collection-item-main"><input type="checkbox" :checked="compareSelection.includes(item.itemId)" :disabled="!compareSelection.includes(item.itemId)&&compareSelection.length>=4" :aria-label="`选择 ${item.itemName} 参与比较`" @change="toggleCompareSelection(item.itemId)"><button class="collection-school-link" @click="dialogMode=null;emit('school',item.itemId)">{{item.itemName}}</button><button :disabled="saving('school',item.itemId)" @click="toggle('school',item.itemId,'target')">移除</button></div><div class="collection-note-summary"><p>{{item.note||'未添加家庭备注'}}</p><button :aria-label="`${item.note?'编辑':'添加'} ${item.itemName} 家庭备注`" @click="openNoteEditor(item)">{{item.note?'编辑备注':'添加备注'}}</button></div><div v-if="editingNoteKey===`school-${item.itemId}`" class="collection-note-editor"><label>家庭讨论备注<textarea v-model="noteDraft" maxlength="500" :aria-label="`${item.itemName} 家庭讨论备注`" placeholder="写下已经讨论出的结论，或还要核验的事。"></textarea></label><small>{{noteDraft.length}} / 500</small><div><button @click="closeNoteEditor">取消</button><button :disabled="noteSaving" @click="saveEditedNote(item)">{{noteSaving?'保存中…':'保存备注'}}</button></div></div></li></ul><p v-else>还没有收藏学校</p></section>
              </div>
              <p v-if="compareError" class="comparison-error" role="alert">{{compareError}}</p><small class="collection-storage">● 保存在公开共享数据库，所有访客都能查看和修改</small>
              <footer><button class="collection-secondary" @click="dialogMode=null">完成</button><button class="collection-secondary" :disabled="compareSelection.length<2||compareLoading" @click="startComparison">{{compareLoading?'正在读取详情…':`比较已选 ${compareSelection.length} 所`}}</button><button ref="briefButton" class="collection-primary" :disabled="compareSelection.length<1||familyLoading" @click="openFamilyBrief">{{familyLoading?'正在整理…':`给爸妈看 (${compareSelection.length})`}}</button></footer>
            </template>
            <template v-else>
              <button class="comparison-back" @click="collectionView='list'">← 返回收藏</button><span class="collection-eyebrow">基于当前档案</span><h3>院校对比</h3><p>只对照数据库中已有的核验事实，缺失项不会被猜测补齐。</p>
              <div class="school-comparison-grid" :style="{'--comparison-columns':comparisonDetails.length}">
                <article v-for="detail in comparisonDetails" :key="detail.school.id" class="school-comparison-column">
                  <header><button :aria-label="`查看 ${detail.school.name} 详情`" @click="dialogMode=null;emit('school',detail.school.id)">{{detail.school.name}} ↗</button><span>{{detail.school.city}} · {{detail.school.level}}</span></header>
                   <dl><div><dt>当前档案招生位置</dt><dd v-if="currentAdmission(detail)"><b>{{currentAdmission(detail)?.risk||'仅供核验'}} · {{currentAdmission(detail)?.confidence}}</b><span>{{currentAdmission(detail)?.year}} · {{currentAdmission(detail)?.minRank?`最低位次 ${currentAdmission(detail)?.minRank?.toLocaleString()}`:'位次待核验'}}</span></dd><dd v-else>暂无可比招生记录</dd></div><div><dt>选科要求</dt><dd>{{subjectSummary(detail)}}</dd></div><div><dt>{{detail.featuredMajors.length?'优势专业':'推荐关注'}}</dt><dd>{{(detail.featuredMajors.length?detail.featuredMajors:detail.recommendedMajors).slice(0,3).map(item=>item.name).join('、')}}</dd></div><div><dt>数据缺口</dt><dd><span v-for="gap in dataGaps(detail)" :key="gap">{{gap}}</span></dd></div></dl>
                  <button class="comparison-remove" :disabled="saving('school',detail.school.id)" @click="removeCompared(detail)">移出收藏</button>
                </article>
              </div>
              <section class="comparison-analysis" aria-live="polite">
                <header><b>AI 对比结论</b><small v-if="analysisMode">{{analysisMode==='ai'?'AI 分析':'本地规则分析'}}</small></header>
                <p v-if="analysisLoading" class="analysis-loading">正在对比已核验信息…</p>
                <div v-else-if="comparisonAnalysis" class="analysis-content">{{comparisonAnalysis}}</div>
                <p v-else-if="analysisError" class="analysis-error">{{analysisError}} <button type="button" @click="loadComparisonAnalysis">重试</button></p>
              </section>
            </template>
          </template>
        </section>
      </div>
    </Transition>
  </Teleport>
  <Teleport to="body"><FamilyBrief v-if="familyBriefOpen&&dashboard" :profile-id="profileId" :profile-summary="dashboard.profileSummary" :planning-coordinate="dashboard.planningCoordinate" :details="familyDetails" :saved-items="dashboard.savedItems" @note-saved="applyFamilyBriefNote" @close="closeFamilyBrief" /></Teleport>
  </div>
</template>
