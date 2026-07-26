import {expect,test} from '@playwright/test'
import mysql from 'mysql2/promise'
import {config} from '../../server/config'
import {migrateAdvisorV2} from '../../scripts/migrate-advisor-v2'

test('旧聊天迁移执行两次仍只生成一份以前的讨论',async({request})=>{
  const profileResponse=await request.post('/api/profiles',{data:{studentName:`旧聊天迁移-${Date.now()}`,province:'河南',subjectGroup:'物理类',selectedSubjects:['物理','化学','生物'],score:620,provinceRank:12000}})
  const profileId=(await profileResponse.json()).data.id as string
  try{
    const legacy=await request.post(`/api/profiles/${profileId}/advisor/messages`,{data:{message:'以前问过的专业问题'}})
    expect(legacy.ok()).toBeTruthy()
    const migrationConnection=await mysql.createConnection({host:config.DB_HOST,port:config.DB_PORT,user:process.env.ROOT_DB_USER??'root',password:process.env.ROOT_DB_PASSWORD??'',database:config.DB_NAME})
    try{await migrateAdvisorV2(migrationConnection,config.DB_NAME);await migrateAdvisorV2(migrationConnection,config.DB_NAME)}finally{await migrationConnection.end()}

    const listResponse=await request.get(`/api/profiles/${profileId}/advisor/conversations`)
    const list=(await listResponse.json()).data
    expect(list.total).toBe(1)
    expect(list.items[0].title).toBe('以前的讨论')
    const messagesResponse=await request.get(`/api/profiles/${profileId}/advisor/conversations/${list.items[0].id}/messages`)
    expect((await messagesResponse.json()).data.items).toHaveLength(2)
  }finally{await request.delete(`/api/profiles/${profileId}`)}
})
