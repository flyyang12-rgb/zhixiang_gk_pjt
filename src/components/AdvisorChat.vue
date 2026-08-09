<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref} from 'vue'
import {createAdvisorConversation,deleteAdvisorConversation,getAdvisorConversations,getConversationMessages,sendConversationMessage,type AdvisorConversation,type AdvisorFocus,type AdvisorMessage} from '../api'
import {parseAdvisorTransparency,plainAdvisorText} from '../advisor-transparency'
import {createClientMessageId} from '../client-message-id'

const props=defineProps<{profileId:string;studentName:string;province:string;subjectGroup:string;provinceRank:number|null;initialPrompt:string;initialFocus:AdvisorFocus|null}>()
const emit=defineEmits<{back:[focus:AdvisorFocus|null];recommendations:[];report:[]}>()
const messages=ref<AdvisorMessage[]>([]),draft=ref(props.initialPrompt),sending=ref(false),loading=ref(true),list=ref<HTMLElement|null>(null)
const conversations=ref<AdvisorConversation[]>([]),conversationPage=ref(1),conversationTotal=ref(0),activeConversation=ref<AdvisorConversation|null>(null),activeFocus=ref<AdvisorFocus|null>(props.initialFocus),error=ref(''),nextCursor=ref<number|null>(null)
const historyOpen=ref(false),historyButton=ref<HTMLButtonElement|null>(null)
const focusName=computed(()=>activeFocus.value?.type==='school'?activeFocus.value.schoolName:activeFocus.value?.majorName)
const returnLabel=computed(()=>focusName.value?`返回${focusName.value}`:'返回专业与学校')
const presentedMessages=computed(()=>messages.value.map(message=>{const displayContent=message.role==='assistant'?plainAdvisorText(message.content):message.content;return {message,displayContent,transparency:message.role==='assistant'?parseAdvisorTransparency(displayContent):null}}))

onMounted(async()=>{try{await refreshConversations(true)}catch(value){error.value=readError(value,'聊天记录加载失败')}finally{loading.value=false;await nextTick();scrollToLatest('auto')}window.addEventListener('keydown',handleEscape)})
onBeforeUnmount(()=>window.removeEventListener('keydown',handleEscape))

function readError(value:unknown,fallback:string){return value instanceof Error?value.message:fallback}
async function refreshConversations(reset=false){
  if(reset){conversationPage.value=1;conversations.value=[]}
  const page=await getAdvisorConversations(props.profileId,conversationPage.value)
  conversations.value=reset?page.items:[...conversations.value,...page.items]
  conversationTotal.value=page.total
}
async function loadMoreConversations(){conversationPage.value+=1;try{await refreshConversations()}catch(value){conversationPage.value-=1;error.value=readError(value,'更多记录加载失败')}}
async function openConversation(conversation:AdvisorConversation){
  if(conversation.id===activeConversation.value?.id){closeHistory();return}
  loading.value=true;error.value=''
  try{const page=await getConversationMessages(props.profileId,conversation.id);messages.value=page.items;nextCursor.value=page.nextCursor;activeConversation.value=conversation;activeFocus.value=conversation.focus;draft.value='';closeHistory();await nextTick();scrollToLatest('auto')}
  catch(value){error.value=readError(value,'历史会话加载失败')}finally{loading.value=false}
}
async function loadOlder(){if(!activeConversation.value||!nextCursor.value)return;const page=await getConversationMessages(props.profileId,activeConversation.value.id,nextCursor.value);messages.value=[...page.items,...messages.value];nextCursor.value=page.nextCursor}
async function send(text=draft.value,retryId?:string){
  const content=text.trim();if(!content||sending.value)return
  const clientMessageId=retryId??createClientMessageId()
  let optimistic=messages.value.find(item=>item.clientMessageId===clientMessageId&&item.role==='user')
  if(!optimistic){optimistic={role:'user',content,createdAt:new Date().toISOString(),clientMessageId,status:'pending'};messages.value.push(optimistic)}else optimistic.status='pending'
  optimistic.retryText=undefined;draft.value='';sending.value=true;error.value='';await nextTick();scrollToLatest('smooth')
  try{
    const result=activeConversation.value
      ?await sendConversationMessage(props.profileId,activeConversation.value.id,content,clientMessageId)
      :await createAdvisorConversation(props.profileId,content,clientMessageId,activeFocus.value)
    if(result.conversation)activeConversation.value=result.conversation
    const index=messages.value.indexOf(optimistic)
    messages.value.splice(index,1,result.userMessage,{...result.assistantMessage,mode:result.mode,focus:result.focus??undefined,evidenceRefs:result.evidenceRefs})
    activeFocus.value=result.focus??activeFocus.value
    await refreshConversations(true)
    if(activeConversation.value){const current=conversations.value.find(item=>item.id===activeConversation.value?.id);if(current)activeConversation.value=current}
  }catch(value){optimistic.status='failed';optimistic.retryText=content;error.value=readError(value,'这条问题没有发送成功')}
  finally{sending.value=false;await nextTick();scrollToLatest('smooth')}
}
async function removeConversation(conversation:AdvisorConversation){
  if(!window.confirm(`确定删除“${conversation.title}”吗？\n\n这段聊天会从本机永久删除，无法恢复。`))return
  try{await deleteAdvisorConversation(props.profileId,conversation.id);if(activeConversation.value?.id===conversation.id){activeConversation.value=null;activeFocus.value=null;messages.value=[];nextCursor.value=null;draft.value=''}await refreshConversations(true)}catch(value){error.value=readError(value,'会话删除失败')}
}
function startNewDraft(){activeConversation.value=null;activeFocus.value=null;messages.value=[];nextCursor.value=null;draft.value='';closeHistory()}
function scrollToLatest(behavior:ScrollBehavior){list.value?.scrollTo({top:list.value.scrollHeight,behavior})}
function onComposerKeydown(event:KeyboardEvent){if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send()}}
function openHistory(){historyOpen.value=true}
function closeHistory(){if(!historyOpen.value)return;historyOpen.value=false;nextTick(()=>historyButton.value?.focus())}
function handleEscape(event:KeyboardEvent){if(event.key==='Escape'&&historyOpen.value){event.preventDefault();closeHistory()}}
</script>

<template>
  <div class="advisor-page">
    <header><button class="back-button" :aria-label="returnLabel" @click="emit('back',activeFocus)">←</button><div><span class="kicker">{{activeConversation?'继续上次讨论':'新的顾问会话'}}</span><h2>知向规划顾问</h2><p>咱们只拿当前能核对的资料说话。听不懂的术语，我会顺手解释清楚。</p><small class="methodology-status">● 记前文 · 说人话 · 不编造数据</small></div><button class="secondary-action" @click="emit('report')">导出 PDF 报告</button></header>
    <button ref="historyButton" class="mobile-history-button" aria-haspopup="dialog" @click="openHistory">聊天记录 {{conversationTotal?`(${conversationTotal})`:''}}</button>
    <div class="advisor-layout">
      <aside class="advisor-history-panel"><strong>{{studentName}} 的聊天记录</strong><small>第一次发送后才保存，不会留下空会话</small><button class="new-draft-button" @click="startNewDraft">＋ 新的讨论</button><div class="advisor-conversation-list"><article v-for="conversation in conversations" :key="conversation.id" :class="{active:conversation.id===activeConversation?.id}"><button class="conversation-main" @click="openConversation(conversation)"><span class="conversation-type">{{conversation.focus?.type==='school'?'校':conversation.focus?.type==='major'?'专':'聊'}}</span><span class="conversation-copy"><b>{{conversation.focus?.type==='school'?conversation.focus.schoolName:conversation.focus?.type==='major'?conversation.focus.majorName:conversation.title}}</b><small>{{conversation.lastMessagePreview}}</small><time>{{conversation.messageCount}} 条 · {{new Date(conversation.updatedAt??conversation.createdAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}}</time></span></button><button class="conversation-delete" :aria-label="`删除${conversation.title}`" @click="removeConversation(conversation)">×</button></article></div><button v-if="conversations.length<conversationTotal" class="load-more" @click="loadMoreConversations">加载更多</button><button class="advisor-return" :aria-label="returnLabel" @click="emit('back',activeFocus)">← {{returnLabel}}</button><p>记录保存在这台电脑的 MySQL 中。若配置了外部 AI，只发送回答当前问题需要的最少资料，不发送数据库密码、API Key 或无关档案。</p></aside>
      <main>
        <div v-if="activeFocus" class="advisor-focus"><span>正在讨论：<b>{{focusName}}</b></span><small>返回时会回到这里</small></div>
        <div ref="list" class="message-list" aria-live="polite"><button v-if="nextCursor" class="older-messages" @click="loadOlder">查看更早消息</button><p v-if="loading" class="typing">正在打开聊天记录…</p><div v-else-if="!messages.length" class="advisor-empty"><strong>{{focusName?`先聊聊${focusName}`:'有什么拿不准的，直接问'}}</strong><p>{{focusName?'问题已经替你写在下面，确认后再发送。':'比如：这个专业普通学生毕业后能做什么？'}}</p></div><div v-for="({message,displayContent,transparency},index) in presentedMessages" :key="message.id??message.clientMessageId??index" :class="['message',message.role,{failed:message.status==='failed','has-transparency':transparency}]"><small>{{message.role==='user'?'你':'知向顾问'}}</small><section v-if="transparency" class="advisor-transparency" aria-label="这次回答的关键信息"><div class="confirmed"><b>现在能确定</b><span>{{transparency.confirmed}}</span></div><div class="unknown"><b>还不能确定</b><span>{{transparency.unknown}}</span></div><div class="next-step"><b>下一步只做</b><span>{{transparency.nextStep}}</span></div></section><p v-if="!transparency||transparency.detail" :class="{'advisor-answer-detail':transparency}">{{transparency?.detail??displayContent}}</p><div v-if="message.status==='failed'" class="message-failure"><span>没有发送成功，聊天记录未重复保存。</span><button @click="send(message.retryText??message.content,message.clientMessageId)">重新发送</button></div><details v-if="message.evidenceRefs?.length" class="evidence-refs"><summary>查看这次引用的资料</summary><a v-for="refItem in message.evidenceRefs" :key="refItem.url" :href="refItem.url" target="_blank" rel="noreferrer">{{refItem.title}} · {{refItem.publisher}}</a></details></div><div v-if="sending" class="advisor-typing typing">我正在按最新资料重新核对，稍等一下…</div></div>
        <div class="quick-asks"><button @click="send('这个到底能不能报？')">到底能不能报</button><button @click="send('普通学生毕业后一般能做什么？要不要读研？')">毕业后干什么</button><button @click="send('这件事最大的风险是什么？')">最大的风险</button></div>
        <form @submit.prevent="send()"><label class="sr-only" for="advisor-question">继续问升学规划顾问</label><textarea id="advisor-question" v-model="draft" :placeholder="focusName?`继续问关于${focusName}的问题`:'把你们家最拿不准的事写在这里'" @keydown="onComposerKeydown"></textarea><button class="primary-action" :disabled="sending||loading||!draft.trim()">发送 →</button></form><small class="composer-hint">Enter 发送，Shift+Enter 换行</small>
      </main>
    </div>
    <Teleport to="body"><div v-if="historyOpen" class="advisor-history-backdrop" @click.self="closeHistory"><section role="dialog" aria-modal="true" aria-label="聊天记录" class="advisor-history-sheet"><header><div><strong>聊天记录</strong><small>共 {{conversationTotal}} 段</small></div><button aria-label="关闭聊天记录" @click="closeHistory">×</button></header><button class="sheet-new-draft" @click="startNewDraft">＋ 新的讨论</button><div class="sheet-conversation-list"><article v-for="conversation in conversations" :key="conversation.id"><button @click="openConversation(conversation)"><b>{{conversation.focus?.type==='school'?'学校 · ':conversation.focus?.type==='major'?'专业 · ':'普通讨论 · '}}{{conversation.focus?.type==='school'?conversation.focus.schoolName:conversation.focus?.type==='major'?conversation.focus.majorName:conversation.title}}</b><span>{{conversation.lastMessagePreview}}</span><time>{{conversation.messageCount}} 条 · {{new Date(conversation.updatedAt??conversation.createdAt).toLocaleString('zh-CN')}}</time></button><button :aria-label="`删除${conversation.title}`" @click="removeConversation(conversation)">删除</button></article></div><button v-if="conversations.length<conversationTotal" class="sheet-load-more" @click="loadMoreConversations">加载更多</button></section></div></Teleport>
  </div>
</template>
