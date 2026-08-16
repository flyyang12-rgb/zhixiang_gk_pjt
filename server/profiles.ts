import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import type { DatabaseResult, DatabaseRow as RowDataPacket } from './database.js'
import { z } from 'zod'
import { database } from './database.js'

const router = Router()

const profileInput = z.object({
  studentName: z.string().trim().min(1, '请填写学生称呼').max(32, '学生称呼不能超过 32 个字'),
  province: z.enum(['河南', '山东', '河北'], { message: '首期请选择河南、山东或河北' }),
  subjectGroup: z.string().trim().min(1, '请选择科类').max(64),
  selectedSubjects: z.array(z.enum(['物理','历史','化学','生物','政治','地理'])).max(3).default([]),
  score: z.number().int().min(100, '分数不能低于 100').max(750, '分数不能高于 750').nullable(),
  provinceRank: z.number().int().positive('位次必须大于 0').nullable(),
  planningMode: z.enum(['exploration', 'application']).default('application'),
}).superRefine((input, context) => {
  if (input.planningMode === 'application' && input.score === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['score'], message: '志愿填报模式请填写分数' })
  }
})

router.post('/', async (request, response, next) => {
  let connection: Awaited<ReturnType<typeof database.getConnection>> | null = null
  try {
    const input = profileInput.parse(request.body)
    const id = randomUUID()
    const [provinces] = await database.execute<ProvinceRow[]>(
      'SELECT id FROM provinces WHERE name = ? LIMIT 1',
      [input.province],
    )

    if (!provinces[0]) {
      response.status(422).json({ success: false, data: null, error: '省份基础数据尚未初始化', requestId: response.locals.requestId })
      return
    }

    connection = await database.getConnection()
    await connection.beginTransaction()
    await connection.execute(
      `INSERT INTO student_profiles
        (id, student_name, province_id, subject_group, selected_subjects, score, province_rank, current_stage, planning_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'recommendation', ?)`,
      [id, input.studentName, provinces[0].id, input.subjectGroup, JSON.stringify(input.selectedSubjects), input.score, input.provinceRank, input.planningMode],
    )
    if (input.score !== null || input.provinceRank !== null) {
      await connection.execute(`INSERT INTO profile_score_snapshots(profile_id,exam_name,exam_date,score,province_rank,is_current,origin_key) VALUES (?,'建档坐标',CURRENT_DATE,?,?,1,?)`,[id,input.score,input.provinceRank,`baseline:${id}`])
    }
    await connection.commit()

    response.status(201).json({ success: true, data: { id }, error: null, requestId: response.locals.requestId })
  } catch (error) {
    if (connection) await connection.rollback()
    next(error)
  } finally { connection?.release() }
})

const snapshotInput=z.object({examName:z.string().trim().min(1,'请填写考试名称').max(64),examDate:z.string().date(),score:z.number().int().min(100).max(750),provinceRank:z.number().int().positive().max(2_000_000).nullable(),note:z.string().trim().max(200).nullable().optional()})

router.get('/:id/score-snapshots',async(request,response,next)=>{
  try{
    const id=z.string().uuid().parse(request.params.id)
    const [profiles]=await database.query<RowDataPacket[]>('SELECT id FROM student_profiles WHERE id=?',[id])
    if(!profiles[0]){response.status(404).json({success:false,data:null,error:'没有找到这个学生档案',requestId:response.locals.requestId});return}
    const [rows]=await database.query<RowDataPacket[]>(`SELECT id,exam_name examName,TO_CHAR(exam_date,'YYYY-MM-DD') examDate,score,province_rank provinceRank,note,is_current isCurrent,created_at createdAt FROM profile_score_snapshots WHERE profile_id=? ORDER BY exam_date,id`,[id])
    response.json({success:true,data:rows.map(row=>({...row,id:Number(row.id),score:row.score==null?null:Number(row.score),provinceRank:row.provinceRank==null?null:Number(row.provinceRank),isCurrent:Boolean(row.isCurrent)})),error:null,requestId:response.locals.requestId})
  }catch(error){next(error)}
})

router.post('/:id/score-snapshots',async(request,response,next)=>{
  const connection=await database.getConnection()
  try{
    const id=z.string().uuid().parse(request.params.id),input=snapshotInput.parse(request.body)
    await connection.beginTransaction()
    const [profiles]=await connection.query<RowDataPacket[]>('SELECT id FROM student_profiles WHERE id=? FOR UPDATE',[id])
    if(!profiles[0]){await connection.rollback();response.status(404).json({success:false,data:null,error:'没有找到这个学生档案',requestId:response.locals.requestId});return}
    await connection.execute('UPDATE profile_score_snapshots SET is_current=0 WHERE profile_id=?',[id])
    const [inserted]=await connection.execute<DatabaseResult>(`INSERT INTO profile_score_snapshots(profile_id,exam_name,exam_date,score,province_rank,note,is_current) VALUES (?,?,?,?,?,?,1) RETURNING id`,[id,input.examName,input.examDate,input.score,input.provinceRank,input.note??null])
    await connection.execute('UPDATE student_profiles SET score=?,province_rank=? WHERE id=?',[input.score,input.provinceRank,id])
    await connection.commit()
    response.status(201).json({success:true,data:{id:inserted.insertId,...input,note:input.note??null,isCurrent:true},error:null,requestId:response.locals.requestId})
  }catch(error){await connection.rollback();next(error)}finally{connection.release()}
})

router.delete('/:id/score-snapshots/:snapshotId',async(request,response,next)=>{
  const connection=await database.getConnection()
  try{
    const id=z.string().uuid().parse(request.params.id),snapshotId=z.coerce.number().int().positive().parse(request.params.snapshotId)
    await connection.beginTransaction()
    const [rows]=await connection.query<RowDataPacket[]>('SELECT is_current isCurrent FROM profile_score_snapshots WHERE id=? AND profile_id=? FOR UPDATE',[snapshotId,id])
    if(!rows[0]){await connection.rollback();response.status(404).json({success:false,data:null,error:'没有找到这条模考记录',requestId:response.locals.requestId});return}
    const [countRows]=await connection.query<RowDataPacket[]>('SELECT COUNT(*) count FROM profile_score_snapshots WHERE profile_id=?',[id])
    if(Number(countRows[0]?.count)<=1){await connection.rollback();response.status(422).json({success:false,data:null,error:'至少保留一条坐标记录',requestId:response.locals.requestId});return}
    await connection.execute('DELETE FROM profile_score_snapshots WHERE id=? AND profile_id=?',[snapshotId,id])
    let restored=null
    if(Boolean(rows[0].isCurrent)){
      const [previous]=await connection.query<RowDataPacket[]>(`SELECT id,score,province_rank provinceRank FROM profile_score_snapshots WHERE profile_id=? ORDER BY exam_date DESC,id DESC LIMIT 1 FOR UPDATE`,[id])
      restored=previous[0]
      await connection.execute('UPDATE profile_score_snapshots SET is_current=CASE WHEN id=? THEN 1 ELSE 0 END WHERE profile_id=?',[Number(restored!.id),id])
      await connection.execute('UPDATE student_profiles SET score=?,province_rank=? WHERE id=?',[restored!.score,restored!.provinceRank,id])
    }
    await connection.commit()
    response.json({success:true,data:{id:snapshotId,restoredSnapshotId:restored?Number(restored.id):null},error:null,requestId:response.locals.requestId})
  }catch(error){await connection.rollback();next(error)}finally{connection.release()}
})

router.get('/', async (_request, response, next) => {
  try {
    const [rows] = await database.execute<ProfileRow[]>(
      `SELECT sp.id, sp.student_name AS studentName, p.name AS province,
              sp.subject_group AS subjectGroup, sp.selected_subjects AS selectedSubjects, sp.score,
              sp.province_rank AS provinceRank, sp.current_stage AS currentStage, sp.planning_mode AS planningMode,
              sp.updated_at AS updatedAt
       FROM student_profiles sp
       JOIN provinces p ON p.id = sp.province_id
       ORDER BY sp.updated_at DESC LIMIT 50`,
    )
    response.json({ success: true, data: rows, error: null, requestId: response.locals.requestId })
  } catch (error) {
    next(error)
  }
})

router.get('/:id', async (request, response, next) => {
  try {
    const id = z.string().uuid().parse(request.params.id)
    const [rows] = await database.execute<ProfileRow[]>(
      `SELECT sp.id, sp.student_name AS studentName, p.name AS province,
              sp.subject_group AS subjectGroup, sp.selected_subjects AS selectedSubjects, sp.score,
              sp.province_rank AS provinceRank, sp.current_stage AS currentStage, sp.planning_mode AS planningMode,
              sp.updated_at AS updatedAt
       FROM student_profiles sp
       JOIN provinces p ON p.id = sp.province_id
       WHERE sp.id = ? LIMIT 1`,
      [id],
    )

    if (!rows[0]) {
      response.status(404).json({ success: false, data: null, error: '没有找到这个学生档案', requestId: response.locals.requestId })
      return
    }

    response.json({ success: true, data: rows[0], error: null, requestId: response.locals.requestId })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', async (request, response, next) => {
  try {
    const id = z.string().uuid().parse(request.params.id)
    const [result] = await database.execute<DatabaseResult>('DELETE FROM student_profiles WHERE id = ?', [id])
    if (!result.affectedRows) {
      response.status(404).json({ success: false, data: null, error: '没有找到这个学生档案', requestId: response.locals.requestId })
      return
    }
    response.json({ success: true, data: { id }, error: null, requestId: response.locals.requestId })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/rank', async (request, response, next) => {
  let connection:Awaited<ReturnType<typeof database.getConnection>>|null=null
  try {
    const id = z.string().uuid().parse(request.params.id)
    const { provinceRank } = z.object({ provinceRank: z.number().int().positive('位次必须大于 0').max(2_000_000) }).parse(request.body)
    connection=await database.getConnection()
    await connection.beginTransaction()
    const [profiles]=await connection.query<RowDataPacket[]>('SELECT id,score FROM student_profiles WHERE id=? FOR UPDATE',[id])
    if (!profiles[0]) {
      await connection.rollback()
      response.status(404).json({ success: false, data: null, error: '没有找到这个学生档案', requestId: response.locals.requestId })
      return
    }
    await connection.execute('UPDATE student_profiles SET province_rank = ? WHERE id = ?',[provinceRank,id])
    await connection.execute('UPDATE profile_score_snapshots SET province_rank=? WHERE profile_id=? AND is_current=1',[provinceRank,id])
    await connection.execute(`INSERT INTO profile_score_snapshots(profile_id,exam_name,exam_date,score,province_rank,is_current,origin_key)
      SELECT id,'建档坐标',CURRENT_DATE,score,?,1,CONCAT('baseline:',id) FROM student_profiles
      WHERE id=? AND NOT EXISTS(SELECT 1 FROM profile_score_snapshots WHERE profile_id=?)`,[provinceRank,id,id])
    await connection.commit()
    response.json({ success: true, data: { provinceRank }, error: null, requestId: response.locals.requestId })
  } catch (error) {
    if(connection)await connection.rollback()
    next(error)
  } finally { connection?.release() }
})

interface ProvinceRow extends RowDataPacket {
  id: number
}

interface ProfileRow extends RowDataPacket {
  id: string
  studentName: string
  province: string
  subjectGroup: string
  selectedSubjects: string[] | string
  score: number | null
  provinceRank: number | null
  currentStage: 'recommendation'
  planningMode: 'exploration' | 'application'
  updatedAt: Date
}

export const profilesRouter = router
