import {expect,test} from '@playwright/test'

test('顾问会话首次发送原子创建、分页并按客户端消息 ID 幂等重试',async({request})=>{
  const profileResponse=await request.post('/api/profiles',{data:{
    studentName:`顾问V2-${Date.now()}`,
    province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:620,provinceRank:12000,
  }})
  expect(profileResponse.ok()).toBeTruthy()
  const profileId=(await profileResponse.json()).data.id as string
  const clientMessageId=crypto.randomUUID()

  try{
    const createdResponse=await request.post(`/api/profiles/${profileId}/advisor/conversations`,{data:{
      initialMessage:'家里最多能承担四年本科，这个条件请记住。',clientMessageId,
    }})
    expect(createdResponse.status()).toBe(201)
    const created=(await createdResponse.json()).data
    expect(created.conversation.id).toBeTruthy()
    expect(created.userMessage.content).toContain('四年本科')
    expect(created.assistantMessage.content).toContain('记住了')
    expect(created.assistantMessage.content).not.toContain('【先说结论】')

    const retryResponse=await request.post(`/api/profiles/${profileId}/advisor/conversations/${created.conversation.id}/messages`,{data:{
      message:'家里最多能承担四年本科，这个条件请记住。',clientMessageId,
    }})
    expect(retryResponse.ok()).toBeTruthy()

    const messagesResponse=await request.get(`/api/profiles/${profileId}/advisor/conversations/${created.conversation.id}/messages?pageSize=50`)
    expect(messagesResponse.ok(),await messagesResponse.text()).toBeTruthy()
    const messages=(await messagesResponse.json()).data
    expect(messages.items).toHaveLength(2)
    expect(messages.nextCursor).toBeNull()

    const listResponse=await request.get(`/api/profiles/${profileId}/advisor/conversations?page=1&pageSize=20`)
    const page=(await listResponse.json()).data
    expect(page.total).toBe(1)
    expect(page.items[0].messageCount).toBe(2)
    expect(page.items[0].lastMessagePreview).toBeTruthy()

    const followUp=await request.post(`/api/profiles/${profileId}/advisor/conversations/${created.conversation.id}/messages`,{data:{message:'那按这个条件，下一步先查什么？',clientMessageId:crypto.randomUUID()}})
    expect(followUp.ok()).toBeTruthy()
    expect((await followUp.json()).data.assistantMessage.content).toContain('四年本科')

    const deleted=await request.delete(`/api/profiles/${profileId}/advisor/conversations/${created.conversation.id}`)
    expect(deleted.status()).toBe(204)
    const afterDelete=await request.get(`/api/profiles/${profileId}/advisor/conversations?page=1&pageSize=20`)
    expect((await afterDelete.json()).data.total).toBe(0)
  }finally{
    await request.delete(`/api/profiles/${profileId}`)
  }
})

test('短问题先直接接话，不机械复述前文或绕到无关专业',async({request})=>{
  const profileResponse=await request.post('/api/profiles',{data:{
    studentName:`自然表达-${Date.now()}`,province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:545,provinceRank:18500,
  }})
  const profileId=(await profileResponse.json()).data.id as string
  try{
    const created=await request.post(`/api/profiles/${profileId}/advisor/conversations`,{data:{initialMessage:'我比较喜欢计算机，这个方向先记住。',clientMessageId:crypto.randomUUID()}})
    const conversationId=(await created.json()).data.conversation.id as string
    const followUp=await request.post(`/api/profiles/${profileId}/advisor/conversations/${conversationId}/messages`,{data:{message:'我能报计算机吗？',clientMessageId:crypto.randomUUID()}})
    expect(followUp.ok()).toBeTruthy()
    const answer=(await followUp.json()).data.assistantMessage.content as string
    expect(answer).toContain('计算机')
    expect(answer).not.toContain('护理学')
    expect(answer).not.toContain('你前面明确提到')
    expect(answer).not.toContain('【先说结论】')
    expect(answer.length).toBeLessThan(450)
  }finally{await request.delete(`/api/profiles/${profileId}`)}
})

test('学校会话被指出重复后承认问题并接回上一轮目标专业',async({request})=>{
  const schoolsResponse=await request.get('/api/schools?q=苏州科技大学&pageSize=10')
  const schools=(await schoolsResponse.json()).data.items as Array<{id:number;name:string}>
  const school=schools.find(item=>item.name==='苏州科技大学')
  expect(school).toBeTruthy()
  const profileResponse=await request.post('/api/profiles',{data:{studentName:`追问纠偏-${Date.now()}`,province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:545,provinceRank:18500}})
  const profileId=(await profileResponse.json()).data.id as string
  try{
    const createdResponse=await request.post(`/api/profiles/${profileId}/advisor/conversations`,{data:{focus:{type:'school',schoolId:school!.id},initialMessage:'我想学护理',clientMessageId:crypto.randomUUID()}})
    const created=(await createdResponse.json()).data
    const firstAnswer=created.assistantMessage.content as string
    const followUpResponse=await request.post(`/api/profiles/${profileId}/advisor/conversations/${created.conversation.id}/messages`,{data:{message:'你怎么老在重复啊',clientMessageId:crypto.randomUUID()}})
    expect(followUpResponse.ok()).toBeTruthy()
    const secondAnswer=(await followUpResponse.json()).data.assistantMessage.content as string
    expect(secondAnswer).not.toBe(firstAnswer)
    expect(secondAnswer).toContain('你说得对')
    expect(secondAnswer).toContain('护理')
    expect(secondAnswer).not.toContain('【先说结论】')
  }finally{await request.delete(`/api/profiles/${profileId}`)}
})

test('普通会话能从院校简称识别真实学校并读取院校证据',async({request})=>{
  const profileResponse=await request.post('/api/profiles',{data:{studentName:`院校简称-${Date.now()}`,province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:500,provinceRank:105545}})
  const profileId=(await profileResponse.json()).data.id as string
  try{
    const created=await request.post(`/api/profiles/${profileId}/advisor/conversations`,{data:{initialMessage:'我先随便问问志愿的事',clientMessageId:crypto.randomUUID()}})
    expect(created.ok(),await created.text()).toBeTruthy()
    const conversation=(await created.json()).data.conversation
    expect(conversation.focus).toBeNull()

    const response=await request.post(`/api/profiles/${profileId}/advisor/conversations/${conversation.id}/messages`,{data:{message:'南阳理工怎么样',clientMessageId:crypto.randomUUID()}})
    expect(response.ok(),await response.text()).toBeTruthy()
    const result=(await response.json()).data
    expect(result.focus).toMatchObject({type:'school',schoolName:'南阳理工学院'})
    expect(result.assistantMessage.content).toContain('南阳理工学院')
    expect(result.assistantMessage.content).not.toContain('护理学（优先了解）')

    const followUp=await request.post(`/api/profiles/${profileId}/advisor/conversations/${conversation.id}/messages`,{data:{message:'那它的会计怎么样',clientMessageId:crypto.randomUUID()}})
    expect(followUp.ok(),await followUp.text()).toBeTruthy()
    const followUpResult=(await followUp.json()).data
    expect(followUpResult.focus).toMatchObject({type:'school',schoolName:'南阳理工学院'})
    expect(followUpResult.assistantMessage.content).toContain('南阳理工学院')
    expect(followUpResult.assistantMessage.content).toContain('会计')

    const vague=await request.post(`/api/profiles/${profileId}/advisor/conversations`,{data:{initialMessage:'理工怎么样',clientMessageId:crypto.randomUUID()}})
    expect(vague.ok(),await vague.text()).toBeTruthy()
    expect((await vague.json()).data.focus).toBeNull()
  }finally{await request.delete(`/api/profiles/${profileId}`)}
})
