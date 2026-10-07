<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getProfessionDashboard, getSchoolComparisonAnalysis, getSchoolDetail, removeDashboardItem, saveDashboardItem, updateDashboardItemNote, type AdvisorFocus, type ProfessionCard, type ProfessionDashboard, type SavedItem, type SchoolDetail } from '../api'
import { buildProfessionInsights } from '../profession-insights'
import FamilyBrief from './FamilyBrief.vue'
import ExplorationWorkspace from './ExplorationWorkspace.vue'
import ScoreTimeline from './ScoreTimeline.vue'
import MajorComparison from './MajorComparison.vue'
import SchoolComparison from './SchoolComparison.vue'
import MajorExplorationBrief from './MajorExplorationBrief.vue'
import { interactionError } from '../interaction-errors'

const props=defineProps<{profileId:string;studentName:string;initialMajorId?:number|null}>()
const emit=defineEmits<{school:[number];advisor:[{prompt:string;focus:AdvisorFocus}];profileCoordinate:[{profileId:string;score:number|null;provinceRank:number|null}]}>()
const dashboard=ref<ProfessionDashboard|null>(null),loading=ref(true),error=ref(''),expanded=ref<number|null>(null)
const detailPanel=ref<HTMLElement|null>(null)
const explorationWorkspace=ref<InstanceType<typeof ExplorationWorkspace>|null>(null)
const applicationSavedDetailId=ref<number|null>(null)
let applicationWindowScroll=0,applicationContainerScroll=0
const collectionDialog=ref<HTMLElement|null>(null)
let dialogPreviousFocus:HTMLElement|null=null
let savedReadSequence=0,noteWriteSequence=0,collectionContextRequest=0,alive=true
const savingKeys=ref(new Set<string>()),actionMessage=ref('')
const dialogMode=ref<'confirmation'|'collection'|null>(null)
const collectionView=ref<'list'|'compare'|'major-compare'|'major-brief'>('list'),compareSelection=ref<number[]>([]),comparisonDetails=ref<SchoolDetail[]>([]),compareLoading=ref(false),compareError=ref('')
const majorSelection=ref<number[]>([]),majorSelectionMessage=ref(''),majorPanel=ref<HTMLElement|null>(null)
let majorViewAction:'compare'|'brief'='compare'
const comparisonAnalysis=ref(''),analysisMode=ref<'ai'|'local'|null>(null),analysisLoading=ref(false),analysisError=ref('')
const lastSaved=ref<{itemType:'major'|'school';itemName:string}|null>(null)
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
watch(dialogMode,async(mode,previous)=>{
  if(mode!=='collection')collectionContextRequest++
  if(mode){if(!previous)dialogPreviousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;await nextTick();collectionDialog.value?.querySelector<HTMLElement>('button')?.focus()}
  else{await nextTick();if(!alive)return;if(dialogPreviousFocus?.isConnected&&!dialogPreviousFocus.matches(':disabled'))dialogPreviousFocus.focus({preventScroll:true});else (detailPanel.value??document.querySelector<HTMLElement>('.exploration-detail'))?.focus({preventScroll:true})}
})
watch(()=>savedMajors.value.map(item=>item.itemId),ids=>{
  const next=majorSelection.value.filter(id=>ids.includes(id))
  if(next.length!==majorSelection.value.length){majorSelection.value=next;majorSelectionMessage.value='已移除不再关注的专业选择'}
  if((collectionView.value==='major-compare'&&next.length<2)||(collectionView.value==='major-brief'&&next.length<1))void closeMajorView()
})
watch(()=>savedSchools.value.map(item=>item.itemId),ids=>{compareSelection.value=compareSelection.value.filter(id=>ids.includes(id))})

onMounted(()=>{load();window.addEventListener('keydown',handleWindowKeys)})
onBeforeUnmount(()=>{alive=false;savedReadSequence++;noteWriteSequence++;collectionContextRequest++;window.removeEventListener('keydown',handleWindowKeys)})
async function load(){loading.value=true;error.value='';const profileId=props.profileId;try{const result=await getProfessionDashboard(profileId);if(!alive||props.profileId!==profileId)return;dashboard.value=result;emit('profileCoordinate',{profileId,score:result.profileSummary.score,provinceRank:result.profileSummary.provinceRank});expanded.value=props.initialMajorId??null;if(result.mode==='application'&&props.initialMajorId&&!result.cards.some(card=>card.id===props.initialMajorId))applicationSavedDetailId.value=props.initialMajorId}catch(value){if(alive)error.value=interactionError(value,'工作台资料加载失败，请检查网络后重试')}finally{if(alive)loading.value=false}}
async function refreshSavedItems(){
  const profileId=props.profileId,request=++savedReadSequence
  try{const result=await getProfessionDashboard(profileId);if(alive&&request===savedReadSequence&&props.profileId===profileId&&dashboard.value)dashboard.value.savedItems=result.savedItems}
  catch(value){if(alive&&request===savedReadSequence)actionMessage.value=interactionError(value,'收藏状态刷新失败，请检查网络后重试')}
}
defineExpose({refreshSavedItems})
async function openDetail(cardId:number){expanded.value=cardId;await nextTick()}
async function openSavedMajor(item:SavedItem){
  dialogMode.value=null;await nextTick()
  if(dashboard.value?.mode==='exploration')await explorationWorkspace.value?.openDetail(item.itemId)
  else{applicationWindowScroll=window.scrollY;applicationContainerScroll=document.querySelector<HTMLElement>('.profession-dashboard')?.scrollTop??0;applicationSavedDetailId.value=item.itemId}
}
async function closeApplicationMajorDetail(){applicationSavedDetailId.value=null;await nextTick();if(!alive)return;document.querySelector<HTMLElement>('.profession-dashboard')?.scrollTo({top:applicationContainerScroll,behavior:'instant'});window.scrollTo({top:applicationWindowScroll,behavior:'instant'});document.querySelector<HTMLElement>('.collection-entry')?.focus({preventScroll:true})}
function applyExplorationSaved(value:{itemId:number;name:string;state:SavedItem['state']|null;note:string|null;confirm?:boolean}){
  if(!dashboard.value)return
  dashboard.value.savedItems=dashboard.value.savedItems.filter(item=>!(item.itemType==='major'&&item.itemId===value.itemId))
  if(value.state)dashboard.value.savedItems.push({itemType:'major',itemId:value.itemId,state:value.state,note:value.note,itemName:value.name})
  if(value.confirm){lastSaved.value={itemType:'major',itemName:value.name};dialogMode.value='confirmation'}
}
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
function isVisibleCollectionControl(node:HTMLElement){
  // Closed details can still report rectangles in Chrome. Only their first
  // summary remains in the keyboard order; nested closed ancestors matter too.
  for(let closed=node.closest('details:not([open])');closed;closed=closed.parentElement?.closest('details:not([open])')??null){
    if(!closed.querySelector(':scope > summary')?.contains(node))return false
  }
  if(node.getClientRects().length===0)return false
  return typeof node.checkVisibility!=='function'||node.checkVisibility({visibilityProperty:true})
}
function handleWindowKeys(event:KeyboardEvent){
  if(event.defaultPrevented)return
  if(document.querySelector('.school-detail-drawer'))return
  if(familyBriefOpen.value)return
  if(dialogMode.value){
    if(event.key==='Escape'){event.preventDefault();if(dialogMode.value==='collection'&&(collectionView.value==='major-compare'||collectionView.value==='major-brief'))void closeMajorView();else if(dialogMode.value==='collection'&&collectionView.value==='compare')void closeSchoolComparison();else dialogMode.value=null;return}
    if(event.key==='Tab'&&collectionDialog.value){
      const nodes=[...collectionDialog.value.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,[tabindex="0"]')]
        .filter(isVisibleCollectionControl)
      const first=nodes[0],last=nodes.at(-1)
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    }
    return
  }
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
    if(itemType==='major'&&dashboard.value.mode==='exploration')await explorationWorkspace.value?.refresh()
  }catch(value){actionMessage.value=value instanceof Error?value.message:'保存失败，请稍后重试'}
  finally{const next=new Set(savingKeys.value);next.delete(key);savingKeys.value=next}
}
function saving(itemType:'major'|'school',itemId:number){return savingKeys.value.has(`${itemType}-${itemId}`)}
function askMajor(card:ProfessionCard){emit('advisor',{prompt:`请解释${card.name}已核验的学习内容、学习活动和职业门槛，并指出当前资料缺口。只谈专业探索，不判断个人适合度或录取。`,focus:{type:'major',majorId:card.id,majorName:card.name}})}
function openCollection(){actionMessage.value='';dialogMode.value='collection';collectionView.value='list';majorSelection.value=[];majorSelectionMessage.value='';compareSelection.value=[];comparisonDetails.value=[];compareError.value='';comparisonAnalysis.value='';analysisError.value=''}
function toggleMajorSelection(majorId:number){
  if(!savedMajors.value.some(item=>item.itemId===majorId))return
  if(majorSelection.value.includes(majorId))majorSelection.value=majorSelection.value.filter(id=>id!==majorId)
  else if(majorSelection.value.length<3)majorSelection.value=[...majorSelection.value,majorId]
  else{majorSelectionMessage.value='最多选择 3 个专业，请先取消一个选择';return}
  majorSelectionMessage.value=''
}
async function openMajorView(action:'compare'|'brief'){
  const count=majorSelection.value.length
  if(count>3||count<(action==='compare'?2:1)){majorSelectionMessage.value=action==='compare'?'专业比较需要选择 2—3 个专业':'专业简报需要选择 1—3 个已关注专业';return}
  closeNoteEditor();majorViewAction=action;collectionView.value=action==='compare'?'major-compare':'major-brief'
  await nextTick();if(alive)majorPanel.value?.querySelector<HTMLElement>('button')?.focus({preventScroll:true})
}
async function closeMajorView(){
  collectionContextRequest++;collectionView.value='list';await nextTick();if(!alive||dialogMode.value!=='collection')return
  const trigger=collectionDialog.value?.querySelector<HTMLButtonElement>(`[data-major-action="${majorViewAction}"]`)
  if(trigger&&!trigger.disabled)trigger.focus({preventScroll:true})
  else collectionDialog.value?.querySelector<HTMLElement>('.collection-major-checkbox:not(:disabled),.collection-close')?.focus({preventScroll:true})
}
async function refreshCollectionContext(){
  const profileId=props.profileId,request=++collectionContextRequest,result=await getProfessionDashboard(profileId)
  if(!alive||props.profileId!==profileId||request!==collectionContextRequest||dialogMode.value!=='collection'||collectionView.value!=='major-brief')return
  savedReadSequence++
  dashboard.value=result
  emit('profileCoordinate',{profileId,score:result.profileSummary.score,provinceRank:result.profileSummary.provinceRank})
}
function toggleCompareSelection(schoolId:number){if(compareSelection.value.includes(schoolId))compareSelection.value=compareSelection.value.filter(id=>id!==schoolId);else if(compareSelection.value.length<4)compareSelection.value=[...compareSelection.value,schoolId]}
async function startComparison(){if(compareSelection.value.length<2||compareSelection.value.length>4)return;compareLoading.value=true;compareError.value='';comparisonAnalysis.value='';analysisError.value='';try{comparisonDetails.value=await Promise.all(compareSelection.value.map(id=>getSchoolDetail(id,props.profileId)));collectionView.value='compare';await nextTick();if(!alive)return;collectionDialog.value?.scrollTo({top:0,behavior:'instant'});collectionDialog.value?.querySelector<HTMLElement>('.comparison-back')?.focus({preventScroll:true});void loadComparisonAnalysis()}catch(value){compareError.value=value instanceof Error?value.message:'院校比较加载失败'}finally{compareLoading.value=false}}
async function closeSchoolComparison(){collectionView.value='list';await nextTick();if(alive&&dialogMode.value==='collection')collectionDialog.value?.querySelector<HTMLElement>('[data-school-action=compare]')?.focus()}
async function openFamilyBrief(){if(compareSelection.value.length<1||compareSelection.value.length>4)return;familyLoading.value=true;compareError.value='';try{familyDetails.value=await Promise.all(compareSelection.value.map(id=>getSchoolDetail(id,props.profileId)));familyBriefOpen.value=true}catch(value){compareError.value=value instanceof Error?value.message:'家庭简报加载失败'}finally{familyLoading.value=false}}
async function closeFamilyBrief(){familyBriefOpen.value=false;await nextTick();briefButton.value?.focus()}
async function loadComparisonAnalysis(){if(compareSelection.value.length<2)return;analysisLoading.value=true;analysisError.value='';analysisMode.value=null;try{const result=await getSchoolComparisonAnalysis(props.profileId,compareSelection.value);comparisonAnalysis.value=result.content;analysisMode.value=result.mode}catch(value){analysisError.value=value instanceof Error?value.message:'对比分析暂时无法生成'}finally{analysisLoading.value=false}}
async function removeCompared(detail:SchoolDetail){await toggle('school',detail.school.id,'target');if(saved('school',detail.school.id,'target'))return;comparisonDetails.value=comparisonDetails.value.filter(item=>item.school.id!==detail.school.id);compareSelection.value=compareSelection.value.filter(id=>id!==detail.school.id);if(comparisonDetails.value.length<2)await closeSchoolComparison();else void loadComparisonAnalysis()}
function openNoteEditor(item:SavedItem){noteWriteSequence++;noteSaving.value=false;editingNoteKey.value=`${item.itemType}-${item.itemId}`;noteDraft.value=item.note??''}
function closeNoteEditor(){noteWriteSequence++;noteSaving.value=false;editingNoteKey.value=null;noteDraft.value=''}
async function saveEditedNote(item:SavedItem){
  if(!alive||!dashboard.value||noteSaving.value)return
  const profileId=props.profileId,itemType=item.itemType,itemId=item.itemId,key=`${itemType}-${itemId}`
  const request=++noteWriteSequence,submittedDraft=noteDraft.value,note=submittedDraft||null
  noteSaving.value=true
  try{
    const result=await updateDashboardItemNote(profileId,itemType,itemId,note)
    if(!alive||props.profileId!==profileId)return
    const savedItem=dashboard.value?.savedItems.find(value=>value.itemType===itemType&&value.itemId===itemId)
    if(savedItem)savedItem.note=result.note
    if(request===noteWriteSequence&&editingNoteKey.value===key){
      if(noteDraft.value===submittedDraft){actionMessage.value='家庭讨论备注已保存';closeNoteEditor()}
      else actionMessage.value='已保存先前备注，当前修改尚未保存'
    }
  }catch(value){if(alive&&props.profileId===profileId&&request===noteWriteSequence&&editingNoteKey.value===key)actionMessage.value=interactionError(value,'备注保存失败，请检查网络后重试')}
  finally{if(alive&&request===noteWriteSequence&&editingNoteKey.value===key)noteSaving.value=false}
}
function applyFamilyBriefNote(schoolId:number,note:string|null){const savedItem=dashboard.value?.savedItems.find(item=>item.itemType==='school'&&item.itemId===schoolId);if(savedItem)savedItem.note=note;actionMessage.value='家庭讨论备注已保存'}
const factorLabels={coverage:'最近招聘机会多不多',directEntry:'本科毕业能不能直接做',schoolAccess:'按你位次有多少学校可选',stability:'近期需求稳不稳',outlook:'未来发展有没有官方依据'}
</script>

<template>
  <div class="profession-dashboard" :class="{'is-exploration':dashboard?.mode==='exploration'||applicationSavedDetailId!==null}">
    <p v-if="actionMessage" class="save-feedback" role="status">{{actionMessage}}</p>
    <div v-if="loading" class="loading-panel"><span class="spinner"></span><p>正在同步专业与就业数据…</p></div>
    <div v-else-if="error" class="flow-error"><p>{{error}}</p><button @click="load">重新加载</button></div>
    <template v-else-if="dashboard?.mode==='exploration'">
      <ExplorationWorkspace ref="explorationWorkspace" :profile-id="profileId" :student-name="studentName" :list="dashboard.exploration??null" :saved-items="dashboard.savedItems" :initial-major-id="initialMajorId" :modal-open="Boolean(dialogMode)" @school="emit('school',$event)" @advisor="emit('advisor',$event)" @collection="openCollection" @saved="applyExplorationSaved" @feedback="actionMessage=$event" />
      <details class="exploration-score-section"><summary>补充模考记录（稍后也可填写）</summary><ScoreTimeline :profile-id="profileId" :snapshots="dashboard.scoreSnapshots" :coordinate="dashboard.planningCoordinate" @changed="load" /></details>
    </template>
    <template v-else-if="dashboard?.mode==='application'&&applicationSavedDetailId!==null">
      <ExplorationWorkspace ref="explorationWorkspace" :profile-id="profileId" :student-name="studentName" :list="null" :saved-items="dashboard.savedItems" :initial-major-id="applicationSavedDetailId" :modal-open="Boolean(dialogMode)" has-planning-rank detail-only @school="emit('school',$event)" @advisor="emit('advisor',$event)" @collection="openCollection" @saved="applyExplorationSaved" @feedback="actionMessage=$event" @close-detail="closeApplicationMajorDetail" />
    </template>
    <div v-else-if="!dashboard?.cards.length" class="empty-state"><strong>当前没有满足硬条件的专业</strong><p>请核对具体选科、位次和本省专业招生数据；系统不会用学校线或模拟专业凑数。</p></div>
    <template v-else>
      <ScoreTimeline :profile-id="profileId" :snapshots="dashboard.scoreSnapshots" :coordinate="dashboard.planningCoordinate" @changed="load" />
      <section v-if="dashboard?.mode==='application'" class="admission-layer">
        <header><span class="section-number">01</span><div><span class="kicker">学校与专业组参考</span><h3>先看位次可达，再核对组内专业</h3><p>{{dashboard.admissionEvidence.note}}</p></div><strong>{{dashboard.admissionEvidence.confidence}}置信度<small>{{dashboard.admissionEvidence.years.join(' / ')||'暂无可比年份'}}</small></strong></header>
        <div v-if="dashboard.schoolCandidates.length" class="admission-risk-grid">
          <div v-for="risk in risks" :key="risk" class="admission-risk-column"><h4>{{risk}} · 最多 2 所</h4><article v-for="candidate in candidatesByRisk[risk]" :key="candidate.unitId"><span :class="['school-risk',risk]">{{risk}}</span><div><button class="school-title-link" type="button" @click="emit('school',candidate.schoolId)">{{candidate.schoolName}} <span>查看详情 →</span></button><small>{{candidate.city}} · {{candidate.level}} · {{candidate.confidence}}置信度</small><p>{{candidate.unitName}}<template v-if="candidate.subjectRequirement"> · 选科 {{candidate.subjectRequirement}}</template></p><p>参考最低位次 {{candidate.referenceRank.toLocaleString() }} · {{candidate.dataYears.join(' / ')}}</p><nav><a :href="candidate.officialUrl" target="_blank" rel="noreferrer">学校官网 ↗</a><a :href="candidate.admissionsUrl" target="_blank" rel="noreferrer">本科招生网 ↗</a><a :href="candidate.sourceUrl" target="_blank" rel="noreferrer">投档来源 ↗</a></nav></div><button :class="{saved:saved('school',candidate.schoolId,'target')}" :disabled="saving('school',candidate.schoolId)" @click="toggle('school',candidate.schoolId,'target')">{{saving('school',candidate.schoolId)?'保存中…':saved('school',candidate.schoolId,'target')?'★ 已收藏':'☆ 收藏学校'}}</button></article><p v-if="!candidatesByRisk[risk].length" class="no-school">当前没有满足该档位且链接已核验的候选，不凑数。</p></div>
        </div>
        <p v-else class="no-school">当前没有满足位次、选科和链接核验条件的院校专业组。</p>
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
        <section ref="collectionDialog" :class="['collection-dialog',{'exploration-collection-dialog':dashboard?.mode==='exploration','collection-list-view':dialogMode==='collection'&&collectionView==='list','collection-comparison-view':dialogMode==='collection'&&(collectionView==='major-compare'||collectionView==='compare'),'collection-major-view':collectionView==='major-compare'||collectionView==='major-brief'}]" role="dialog" aria-modal="true" :aria-label="dialogMode==='confirmation'?'收藏成功':'我的收藏'">
          <button class="collection-close" aria-label="关闭收藏弹窗" @click="dialogMode=null">×</button>
          <template v-if="dialogMode==='confirmation'">
            <span class="collection-stamp">收藏成功</span>
            <small>{{lastSaved?.itemType==='major'?'专业方向':'目标院校'}}</small>
            <h3>{{lastSaved?.itemName}}</h3>
            <p>已保存到“{{studentName}} 的收藏”。这是公开档案，所有访客都能查看、修改和删除。</p>
            <div class="collection-totals"><span><b>{{savedMajors.length}}</b>个专业</span><i></i><span><b>{{savedSchools.length}}</b>所学校</span></div>
            <footer><button class="collection-secondary" @click="dialogMode=null">继续比较</button><button class="collection-primary" @click="openCollection">查看我的收藏 →</button></footer>
          </template>
          <template v-else>
            <template v-if="collectionView==='list'">
              <span class="collection-eyebrow">当前学生档案</span><h3>{{studentName}} 的收藏</h3><p>勾选想比较的专业或学校，再导出 PDF 带给家人讨论。</p>
              <div class="collection-lists">
                <section>
                  <header><span>专业方向</span><b>{{savedMajors.length}}</b></header>
                  <ul v-if="savedMajors.length"><li v-for="item in savedMajors" :key="`major-${item.itemId}`" :class="['collection-note-row',{'is-selected':majorSelection.includes(item.itemId)}]">
                    <div class="collection-item-main collection-major-row">
                      <input type="checkbox" class="collection-major-checkbox" :checked="majorSelection.includes(item.itemId)" :disabled="!majorSelection.includes(item.itemId)&&majorSelection.length>=3" :aria-label="`选择 ${item.itemName} 参与专业比较或简报`" @change="toggleMajorSelection(item.itemId)">
                      <button class="collection-major-link" :aria-label="`查看收藏专业 ${item.itemName} 详情`" @click="openSavedMajor(item)">{{item.itemName}}</button>
                      <button :disabled="saving('major',item.itemId)" @click="toggle('major',item.itemId,'saved')">移除</button>
                    </div>
                    <div class="collection-note-summary"><p>{{item.note||'未添加家庭备注'}}</p><button :aria-label="`${item.note?'编辑':'添加'} ${item.itemName} 家庭备注`" @click="openNoteEditor(item)">{{item.note?'编辑备注':'添加备注'}}</button></div>
                    <div v-if="editingNoteKey===`major-${item.itemId}`" class="collection-note-editor"><label>家庭讨论备注<textarea v-model="noteDraft" maxlength="500" :aria-label="`${item.itemName} 家庭讨论备注`" placeholder="写下已经讨论出的结论，或还要核验的事。"></textarea></label><small>{{noteDraft.length}} / 500</small><div><button @click="closeNoteEditor">取消</button><button :disabled="noteSaving" @click="saveEditedNote(item)">{{noteSaving?'保存中…':'保存备注'}}</button></div></div>
                  </li></ul><p v-else>还没有收藏专业</p>
                  <p class="collection-selection-count" role="status">已选 {{majorSelection.length}} / 3 个 · 比较需 2—3 个，简报可选 1 个。</p>
                  <p v-if="majorSelectionMessage" class="comparison-error" role="status">{{majorSelectionMessage}}</p>
                  <div class="collection-major-actions">
                    <button type="button" class="collection-secondary" data-major-action="compare" aria-label="比较已选专业" :disabled="majorSelection.length<2||majorSelection.length>3" @click="openMajorView('compare')">比较 {{majorSelection.length}} 个专业</button>
                    <button type="button" class="collection-primary" data-major-action="brief" aria-label="生成专业探索简报" :disabled="majorSelection.length<1||majorSelection.length>3" @click="openMajorView('brief')">生成专业简报</button>
                  </div>
                </section>
                <section><header><span>目标院校</span><b>{{savedSchools.length}}</b></header><ul v-if="savedSchools.length"><li v-for="item in savedSchools" :key="`school-${item.itemId}`" :class="['collection-school-row',{'is-selected':compareSelection.includes(item.itemId)}]"><div class="collection-item-main"><input type="checkbox" :checked="compareSelection.includes(item.itemId)" :disabled="!compareSelection.includes(item.itemId)&&compareSelection.length>=4" :aria-label="`选择 ${item.itemName} 参与比较`" @change="toggleCompareSelection(item.itemId)"><button class="collection-school-link" @click="dialogMode=null;emit('school',item.itemId)">{{item.itemName}}</button><button :disabled="saving('school',item.itemId)" @click="toggle('school',item.itemId,'target')">移除</button></div><div class="collection-note-summary"><p>{{item.note||'未添加家庭备注'}}</p><button :aria-label="`${item.note?'编辑':'添加'} ${item.itemName} 家庭备注`" @click="openNoteEditor(item)">{{item.note?'编辑备注':'添加备注'}}</button></div><div v-if="editingNoteKey===`school-${item.itemId}`" class="collection-note-editor"><label>家庭讨论备注<textarea v-model="noteDraft" maxlength="500" :aria-label="`${item.itemName} 家庭讨论备注`" placeholder="写下已经讨论出的结论，或还要核验的事。"></textarea></label><small>{{noteDraft.length}} / 500</small><div><button @click="closeNoteEditor">取消</button><button :disabled="noteSaving" @click="saveEditedNote(item)">{{noteSaving?'保存中…':'保存备注'}}</button></div></div></li></ul><p v-else>还没有收藏学校</p><p class="collection-selection-count" role="status">已选 {{compareSelection.length}} / 4 所 · 比较需 2—4 所。</p></section>
              </div>
              <p v-if="compareError" class="comparison-error" role="alert">{{compareError}}</p><small class="collection-storage">● 保存在公开共享数据库，所有访客都能查看和修改</small>
              <footer><button class="collection-secondary" @click="dialogMode=null">完成</button><button class="collection-secondary" data-school-action="compare" :disabled="compareSelection.length<2||compareLoading" @click="startComparison">{{compareLoading?'正在读取详情…':`比较已选 ${compareSelection.length} 所`}}</button><button ref="briefButton" class="collection-primary" :disabled="compareSelection.length<1||familyLoading" @click="openFamilyBrief">{{familyLoading?'正在整理…':`给爸妈看 (${compareSelection.length})`}}</button></footer>
            </template>
            <div v-else-if="collectionView==='major-compare'||collectionView==='major-brief'" ref="majorPanel" class="collection-major-content">
              <MajorComparison v-if="collectionView==='major-compare'" :profile-id="profileId" :major-ids="majorSelection" @close="closeMajorView" />
              <MajorExplorationBrief v-else-if="dashboard" :profile-id="profileId" :major-ids="majorSelection" :effective-mode="dashboard.mode" :student-name="studentName" :refresh-context="refreshCollectionContext" @close="closeMajorView" />
            </div>
            <SchoolComparison v-else-if="dashboard" :profile-id="profileId" :details="comparisonDetails" :saved-items="dashboard.savedItems" :analysis="comparisonAnalysis" :analysis-mode="analysisMode" :analysis-loading="analysisLoading" :analysis-error="analysisError" :saving="saving" @back="closeSchoolComparison" @school="dialogMode=null;emit('school',$event)" @remove="removeCompared" @refresh-analysis="loadComparisonAnalysis" />
            <p v-if="actionMessage" class="comparison-error" role="status">{{actionMessage}}</p>
          </template>
        </section>
      </div>
    </Transition>
  </Teleport>
  <Teleport to="body"><FamilyBrief v-if="familyBriefOpen&&dashboard" :profile-id="profileId" :profile-summary="dashboard.profileSummary" :planning-coordinate="dashboard.planningCoordinate" :details="familyDetails" :saved-items="dashboard.savedItems" @note-saved="applyFamilyBriefNote" @close="closeFamilyBrief" /></Teleport>
  </div>
</template>
