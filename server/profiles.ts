import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { database } from './database.js'

const router = Router()

const profileInput = z.object({
  studentName: z.string().trim().min(1, '请填写学生称呼').max(32, '学生称呼不能超过 32 个字'),
  province: z.enum(['河南', '山东', '河北'], { message: '首期请选择河南、山东或河北' }),
  subjectGroup: z.string().trim().min(1, '请选择科类').max(64),
  selectedSubjects: z.array(z.enum(['物理','历史','化学','生物','政治','地理'])).max(3).default([]),
  score: z.number().int().min(100, '分数不能低于 100').max(750, '分数不能高于 750'),
  provinceRank: z.number().int().positive('位次必须大于 0').nullable(),
  planningMode: z.enum(['exploration', 'application']).default('application'),
})

router.post('/', async (request, response, next) => {
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

    await database.execute(
      `INSERT INTO student_profiles
        (id, student_name, province_id, subject_group, selected_subjects, score, province_rank, current_stage, planning_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'recommendation', ?)`,
      [id, input.studentName, provinces[0].id, input.subjectGroup, JSON.stringify(input.selectedSubjects), input.score, input.provinceRank, input.planningMode],
    )

    response.status(201).json({ success: true, data: { id }, error: null, requestId: response.locals.requestId })
  } catch (error) {
    next(error)
  }
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
    const [result] = await database.execute<import('mysql2').ResultSetHeader>('DELETE FROM student_profiles WHERE id = ?', [id])
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
  try {
    const id = z.string().uuid().parse(request.params.id)
    const { provinceRank } = z.object({ provinceRank: z.number().int().positive('位次必须大于 0').max(2_000_000) }).parse(request.body)
    const [result] = await database.execute<import('mysql2').ResultSetHeader>(
      'UPDATE student_profiles SET province_rank = ? WHERE id = ?',
      [provinceRank, id],
    )
    if (!result.affectedRows) {
      response.status(404).json({ success: false, data: null, error: '没有找到这个学生档案', requestId: response.locals.requestId })
      return
    }
    response.json({ success: true, data: { provinceRank }, error: null, requestId: response.locals.requestId })
  } catch (error) {
    next(error)
  }
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
  score: number
  provinceRank: number | null
  currentStage: 'recommendation'
  planningMode: 'exploration' | 'application'
  updatedAt: Date
}

export const profilesRouter = router
