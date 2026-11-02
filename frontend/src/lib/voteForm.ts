// ตัวช่วยของหน้ากรอกโพล ใช้ได้ทั้ง server และ client
import type { Answer, Audience, Ballot, Faculty, Me, PollDetail, PollPreview, PollStatus } from '@/api/types'
import type { ElementItem, InputItem } from '@/store/elementStore'
import { audienceLabel, audienceScope, type AudienceScope } from '@/lib/audienceLabel'
import { elementToItem } from '@/lib/pollMappers'

// radio/select → optionId เดียว · checkbox → array ของ optionId · text → ข้อความ
export type AnswerValue = string | string[]
export type Answers = Record<string, AnswerValue>

// key = id ของ element จาก API (คงที่หลังเปิดโหวต)
export type VoteItem = (InputItem | ElementItem) & { key: string }
export type VoteQuestion = VoteItem & InputItem & { order: number }

export type VoterPoll = {
    id: string
    title: string
    description: string
    coverImageUrl: string | null
    status: PollStatus
    opensAt: string | null
    closesAt: string | null
    // ปิดก่อนกำหนด: หน้ากรอกต้องบอกว่า "ถูกปิดก่อน" ไม่ใช่หมดเวลา
    closedAt: string | null
    closedEarly: boolean
    closeReason: string | null
    audience: Audience
    audienceLabel: string
    audienceScope: AudienceScope | null
    realtime: boolean
    allowAnswerEdit: boolean
    // ระบุคนส่ง: ต้องบอกผู้ตอบก่อนเริ่มว่าเจ้าของโพลจะเห็นรหัสของเขา
    identifySender: boolean
    items: VoteItem[]
    questionCount: number
    resultsPublished: boolean
    canViewResults: boolean
    submitted: boolean
    canEdit: boolean
    isOwner: boolean
}

export function toVoterPoll(poll: PollDetail, faculties: Faculty[]): VoterPoll {
    const items = poll.elements.map((e, i) => {
        const item = elementToItem(e, i)
        return { ...item, key: item.id } as VoteItem
    })
    return {
        id: poll.id,
        title: poll.title,
        description: poll.description,
        coverImageUrl: poll.coverImageUrl,
        status: poll.status,
        opensAt: poll.opensAt,
        closesAt: poll.closesAt,
        closedAt: poll.closedAt,
        closedEarly: poll.closedEarly,
        closeReason: poll.closeReason,
        audience: poll.audience,
        audienceLabel: audienceLabel(poll.audience, faculties),
        audienceScope: audienceScope(poll.audience, faculties),
        realtime: poll.settings.showResultsRealtime,
        allowAnswerEdit: poll.settings.allowAnswerEdit,
        identifySender: poll.settings.identifySender,
        items,
        questionCount: items.filter((i) => i.kind === 'input').length,
        resultsPublished: poll.resultDisplay.published,
        canViewResults: poll.canViewResults,
        submitted: poll.myBallot?.submitted ?? false,
        canEdit: poll.myBallot?.canEdit ?? false,
        isOwner: poll.isOwner,
    }
}

// หน้าแรกของโพลสำหรับคนที่ยังไม่ login: มีแค่ข้อมูลบนการ์ด ไม่มีคำถาม (ต้อง login ก่อนถึงจะเห็น)
export function previewToVoterPoll(poll: PollPreview, faculties: Faculty[]): VoterPoll {
    return {
        id: poll.id,
        title: poll.title,
        description: poll.description,
        coverImageUrl: poll.coverImageUrl,
        status: poll.status,
        opensAt: poll.opensAt,
        closesAt: poll.closesAt,
        closedAt: poll.closedAt,
        closedEarly: poll.closedEarly,
        closeReason: poll.closeReason,
        audience: poll.audience,
        audienceLabel: audienceLabel(poll.audience, faculties),
        audienceScope: audienceScope(poll.audience, faculties),
        realtime: false,
        allowAnswerEdit: false,
        identifySender: poll.identifySender,
        items: [],
        questionCount: poll.questionCount,
        resultsPublished: false,
        canViewResults: false,
        submitted: false,
        canEdit: false,
        isOwner: false,
    }
}

// สถานะที่ทำให้ตอบไม่ได้ (คิดฝั่งหน้าเว็บเพื่อเลือกข้อความ/ปุ่ม · backend ตรวจซ้ำตอน PUT ballot)
// NOT_STARTED = เผยแพร่แล้วแต่ยังไม่ถึงเวลาเปิดที่ตั้งไว้ · LOGIN_REQUIRED = เปิดลิงก์แชร์โดยยังไม่ login
export type IneligibleReason = 'NOT_OPEN' | 'NOT_STARTED' | 'CLOSED' | 'NOT_ELIGIBLE' | 'ALREADY_VOTED' | 'LOGIN_REQUIRED'

// กติกาเดียวกับ backend: public = ใครที่ล็อกอินก็ได้ · chula = ยืนยันผ่าน CUNEX · restricted = ตรงกฎคณะ/ปีเข้า · codes = รหัสอยู่ในรายการ
// ในกฎเดียวกัน ช่องที่ว่าง (null) = ไม่จำกัดเรื่องนั้น
export function isEligible(me: Me, audience: Audience) {
    if (audience.type === 'public') return true
    if (!me.isChulaVerified) return false
    if (audience.type === 'chula') return true
    // codes: ผู้ตอบได้โพลนี้มาก็ต่อเมื่อรหัสอยู่ในรายการอยู่แล้ว (backend ไม่ส่งรายการให้)
    // มีรายการ = เจ้าของ/แอดมินเปิดดู ซึ่งตอบได้เฉพาะเมื่อรหัสตัวเองอยู่ในรายการ
    if (audience.type === 'codes') return !audience.codes || audience.codes.includes(me.studentId ?? '')
    return audience.rules.some((r) =>
        (!r.facultyCode || r.facultyCode === me.faculty?.code)
        && (!r.departmentCode || r.departmentCode === me.departmentCode)
        && (r.studentYear === null || r.studentYear === me.studentYear))
}

// โพลที่ยัง open แต่เลยเวลาปิดแล้วถือว่าปิด เผื่องานตัดสถานะของ backend ยังไม่ได้รัน
export const isBeforeOpening = (poll: Pick<VoterPoll, 'status' | 'opensAt'>, now = Date.now()) =>
    poll.status === 'open' && !!poll.opensAt && new Date(poll.opensAt).getTime() > now

export const isOpenForVoting = (poll: Pick<VoterPoll, 'status' | 'opensAt' | 'closesAt'>, now = Date.now()) =>
    poll.status === 'open' && !isBeforeOpening(poll, now) && !!poll.closesAt && new Date(poll.closesAt).getTime() > now

export function ineligibleReason(poll: VoterPoll, me: Me): IneligibleReason | null {
    if (poll.status !== 'open' && poll.status !== 'closed') return 'NOT_OPEN'
    if (isBeforeOpening(poll)) return 'NOT_STARTED'
    if (poll.status === 'closed' || !isOpenForVoting(poll)) return 'CLOSED'
    // เจ้าของ/แอดมินเห็นโพลได้แม้อยู่นอกกลุ่มผู้ตอบ แต่ตอบไม่ได้
    if (!isEligible(me, poll.audience)) return 'NOT_ELIGIBLE'
    if (poll.submitted && !poll.canEdit) return 'ALREADY_VOTED'
    return null
}

// แบ่งหน้าตาม pagebreak (page_break) ตัวแบ่งไม่ถูกวาด แค่เป็นตัวตัดหน้า
export function paginate<T extends { kind: string; type: string }>(items: T[]): T[][] {
    const pages: T[][] = [[]]
    for (const item of items) {
        if (item.kind === 'element' && item.type === 'pagebreak') {
            pages.push([])
            continue
        }
        pages[pages.length - 1].push(item)
    }
    // ตัดหน้าว่างที่เกิดจาก pagebreak ติดกันหรืออยู่ท้ายสุด
    const filled = pages.filter((page) => page.length > 0)
    return filled.length > 0 ? filled : [[]]
}

export function questionsOf(items: VoteItem[]): VoteQuestion[] {
    return items
        .filter((item): item is VoteItem & InputItem => item.kind === 'input')
        .map((item, index) => ({ ...item, order: index + 1 }))
}

// เพดานความยาวคำตอบข้อความ = maxLength ของคำถาม (backend ตั้งให้ 1000 ถ้าไม่ระบุ)
const DEFAULT_TEXT_ANSWER_MAX = 1000
export const textAnswerMax = (question: { maxLength?: number }) => question.maxLength ?? DEFAULT_TEXT_ANSWER_MAX

export function isAnswered(question: InputItem, value: AnswerValue | undefined) {
    if (value === undefined) return false
    if (question.type === 'checkbox') return Array.isArray(value) && value.length > 0
    return typeof value === 'string' && value.trim() !== ''
}

// ข้อบังคับข้อแรกที่ยังไม่ได้ตอบ (ใช้ทั้งตอนกดถัดไปของแต่ละหน้า และตรวจทั้งฟอร์มก่อนส่ง)
export function firstMissingRequired(questions: VoteQuestion[], answers: Answers) {
    return questions.find((q) => q.required && !isAnswered(q, answers[q.key])) ?? null
}

// หน้าที่ควรกลับไปทำต่อ = หน้าที่มีข้อแรกที่ยังไม่ได้ตอบ ถ้าตอบครบแล้วไปหน้าสุดท้าย
export function resumePageIndex(pages: VoteItem[][], answers: Answers) {
    const index = pages.findIndex((page) =>
        page.some((item) => item.kind === 'input' && !isAnswered(item, answers[item.key])))
    return index === -1 ? pages.length - 1 : index
}

// เวลาโดยประมาณ ~20 วินาทีต่อข้อ ปัดขึ้นเป็นนาที อย่างน้อย 1 นาที
export const estimateMinutes = (questionCount: number) => Math.max(1, Math.ceil((questionCount * 20) / 60))

// คำตอบในหน้าจอ → body ของ PUT /ballot (ข้อที่ไม่ได้ตอบไม่ส่ง)
export function toApiAnswers(questions: VoteQuestion[], answers: Answers): Answer[] {
    return questions.flatMap((q): Answer[] => {
        const v = answers[q.key]
        if (!isAnswered(q, v)) return []
        if (q.type === 'text') return [{ elementId: q.key, text: (v as string).trim() }]
        return [{ elementId: q.key, optionIds: Array.isArray(v) ? v : [v as string] }]
    })
}

// คำตอบในหน้าจอ → Answer ของ API โดยไม่ต้องมีคำถาม (ใช้ตอนบันทึกร่าง) textKeys = คำถามแบบข้อความ
export function answersToApi(answers: Answers, textKeys: string[]): Answer[] {
    return Object.entries(answers).flatMap(([key, v]): Answer[] => {
        if (textKeys.includes(key)) return typeof v === 'string' ? [{ elementId: key, text: v }] : []
        const ids = Array.isArray(v) ? v : v ? [v] : []
        return ids.length > 0 ? [{ elementId: key, optionIds: ids }] : []
    })
}

// Ballot จาก API → คำตอบในหน้าจอ (ใช้ตอนแก้คำตอบ และหน้าดูคำตอบของฉัน)
export function fromBallot(questions: VoteQuestion[], ballot: Pick<Ballot, 'answers'>): Answers {
    const answers: Answers = {}
    for (const a of ballot.answers) {
        const q = questions.find((x) => x.key === a.elementId)
        if (!q) continue
        if ('text' in a) answers[q.key] = a.text
        else answers[q.key] = q.type === 'checkbox' ? a.optionIds : a.optionIds[0]
    }
    return answers
}
