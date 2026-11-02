// รูปข้อมูลตามสัญญา backend `api-endpoints.md` (v1) — ไฟล์นี้คือแหล่งความจริงเดียวของรูป request/response ฝั่งเว็บ
// ถ้า backend เปลี่ยนสัญญา แก้ที่นี่ก่อน แล้ว TypeScript จะชี้ทุกจุดที่ต้องตามแก้
// backend จริง: repo voting-backend · เอกสาร docs/api-endpoints.md และ docs/frontend-migration.md

// ── ทั่วไป ──

export type Uuid = string
// ISO-8601 UTC
export type IsoDateTime = string

export type Page<T> = { items: T[]; nextCursor: string | null }

// application/problem+json (RFC 9457)
export type Problem = {
    type?: string
    title: string
    status: number
    detail?: string
    code: string
    // บาง code แนบรายละเอียดเพิ่ม เช่น POLL_INCOMPLETE / INVALID_ANSWERS / INVALID_IMAGE_URL
    problems?: { path: string; message: string }[]
    currentVersion?: number
    pollStatus?: PollStatus
    facultyCodes?: string[]
}

// ── ผู้ใช้ ──

export type Role = 'user' | 'admin'

export type Department = { code: string; nameTh: string; nameEn: string }

// departments: ยังไม่มีข้อมูลสาขา (CUNEX ไม่ส่งมา) backend จึงไม่ส่งช่องนี้ หน้าเลือกสาขาจะซ่อนเอง
export type Faculty = { code: string; nameTh: string; nameEn: string; departments?: Department[] }

export type Me = {
    id: Uuid
    role: Role
    studentId: string | null
    isChulaVerified: boolean
    faculty: Faculty | null
    studentYear: number | null
    // สาขาของผู้ใช้: ยังไม่มีข้อมูล (ดู departments)
    departmentCode?: string | null
    providers: 'cunex'[]
}

// ── โพล ──

export type PollStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'open' | 'closed'

// departmentCode: ยังไม่ใช้ (backend ไม่เก็บ) · facultyCode/studentYear null = ไม่จำกัดเรื่องนั้น
export type AudienceRule = { facultyCode: string; departmentCode?: string | null; studentYear: number | null }

export type Audience =
    | { type: 'public' }
    | { type: 'chula' }
    | { type: 'restricted'; rules: AudienceRule[] }
    // ระบุรหัส: codes = รหัสนิสิต (10 หลัก) / บุคลากร (8 หลัก) ส่งตอนบันทึก · ได้กลับมาเฉพาะเจ้าของ/แอดมิน
    // codeCount = จำนวนรหัสในรายการ (ผู้ตอบเห็นแค่ตัวเลขนี้)
    | { type: 'codes'; codes?: string[]; codeCount?: number }

export type AudienceType = Audience['type']

export type PollSettings = {
    showResultsRealtime: boolean
    allowAnswerEdit: boolean
    listedPublicly: boolean
    // ระบุคนส่ง: เจ้าของ/แอดมินเห็นรหัสผู้ตอบคู่กับคำตอบ · โพลสาธารณะใช้ไม่ได้ · ล็อกหลังส่งโพล
    identifySender: boolean
}

export type ResultView = 'list' | 'pie' | 'bar'

export type ResultDisplay = {
    // false = ผู้ตอบไม่เห็นผลเลย
    published: boolean
    // ข้อแบบเลือกที่ผู้ตอบเห็น null = ทุกข้อ
    elementIds: Uuid[] | null
    views: ResultView[]
    showCount: boolean
    showPercent: boolean
    showTotal: boolean
}

export type OptionPopup = { buttonText?: string | null; title: string; body: string }

export type ElementOption = {
    id?: Uuid
    label: string
    description?: string | null
    imageUrl?: string | null
    imageAlt?: string | null
    popup?: OptionPopup | null
}

export type ChoiceLayout = 'list' | 'grid'

type ElementBase = { id?: Uuid; title?: string | null; isRequired?: boolean }

export type Element = ElementBase & (
    | { type: 'text_question'; config: { placeholder?: string | null; maxLength?: number | null } }
    | { type: 'single_choice'; config: { layout: ChoiceLayout }; options: ElementOption[] }
    | { type: 'multi_choice'; config: { layout: ChoiceLayout; minSelect?: number | null; maxSelect?: number | null }; options: ElementOption[] }
    | { type: 'dropdown'; config: Record<string, never>; options: ElementOption[] }
    | { type: 'description'; config: { showHeading: boolean; align?: 'left' | 'center' | 'right'; sections: { heading?: string | null; body: string }[] } }
    | { type: 'image'; config: { url?: string | null; alt?: string | null; caption?: string | null } }
    | { type: 'info_popup'; config: { buttonText?: string | null; title: string; body: string; imageUrl?: string | null } }
    | { type: 'accordion'; config: { title: string; body: string } }
    | { type: 'page_break'; config: Record<string, never> }
)

export type ElementType = Element['type']
export type ChoiceElement = Extract<Element, { options: ElementOption[] }>
export type QuestionElement = ChoiceElement | Extract<Element, { type: 'text_question' }>

export const QUESTION_TYPES: ElementType[] = ['text_question', 'single_choice', 'multi_choice', 'dropdown']
export const isQuestion = (e: Element): e is QuestionElement => QUESTION_TYPES.includes(e.type)
export const isChoice = (e: Element): e is ChoiceElement => 'options' in e

export type Review = { decision: 'approved' | 'rejected'; comment: string | null; createdAt: IsoDateTime }

export type MyBallotState = { submitted: boolean; canEdit: boolean }

export type PollDetail = {
    id: Uuid
    status: PollStatus
    version: number
    title: string
    description: string
    coverImageUrl: string | null
    // เวลาเปิดโหวตที่ตั้งล่วงหน้า null = เปิดทันทีที่กด Publish
    opensAt: IsoDateTime | null
    closesAt: IsoDateTime | null
    submittedAt: IsoDateTime | null
    openedAt: IsoDateTime | null
    closedAt: IsoDateTime | null
    closedEarly: boolean
    closeReason: string | null
    audience: Audience
    settings: PollSettings
    resultDisplay: ResultDisplay
    shareUrl: string | null
    elements: Element[]
    myBallot: MyBallotState | null
    canViewResults: boolean
    isOwner: boolean
    // เฉพาะเจ้าของ/แอดมิน
    reviews?: Review[]
    // ถูกแอดมิน takedown · เหตุผลเห็นเฉพาะเจ้าของ/แอดมิน
    takenDown: boolean
    takedownReason?: string | null
}

// หน้าแรกของโพลสำหรับคนที่เปิดลิงก์แชร์โดยยังไม่ login (GET /polls/:id/preview) ไม่มีคำถามและข้อมูลของผู้ดู
export type PollPreview = {
    id: Uuid
    status: PollStatus
    title: string
    description: string
    coverImageUrl: string | null
    opensAt: IsoDateTime | null
    closesAt: IsoDateTime | null
    closedAt: IsoDateTime | null
    closedEarly: boolean
    closeReason: string | null
    audience: Audience
    identifySender: boolean
    questionCount: number
}

export type PollSummary = {
    id: Uuid
    status: PollStatus
    title: string
    description: string
    coverImageUrl: string | null
    audience: AudienceType
    opensAt: IsoDateTime | null
    closesAt: IsoDateTime | null
    openedAt: IsoDateTime | null
    closedAt: IsoDateTime | null
    closedEarly: boolean
    showResultsRealtime: boolean
    identifySender: boolean
    questionCount: number
    createdAt: IsoDateTime
    // เฉพาะหน้ารวมโพล (GET /polls)
    myBallot?: MyBallotState | null
}

// body ของ POST /polls และ PUT /polls/:id (ทุกช่องไม่บังคับตอนเป็นฉบับร่าง)
export type PollDraft = {
    title?: string
    description?: string
    coverImageUrl?: string | null
    opensAt?: IsoDateTime | null
    closesAt?: IsoDateTime | null
    audience?: Audience
    settings?: Partial<PollSettings>
    elements?: Element[]
}

// ── Ballot ──

export type Answer = { elementId: Uuid; optionIds: Uuid[] } | { elementId: Uuid; text: string }

export type Ballot = { answers: Answer[]; submittedAt?: IsoDateTime }

// ── ผลโหวต ──

export type OptionResult = { optionId: Uuid; count: number | null; percent: number | null; weight: number }

export type ElementResult =
    | { elementId: Uuid; type: 'single_choice' | 'multi_choice' | 'dropdown'; answered: number | null; options: OptionResult[] }
    | { elementId: Uuid; type: 'text_question'; answered: number | null }

export type Breakdown = {
    by: 'faculty' | 'year'
    minGroupSize: number
    groups: (
        | { group: string; total: number; elements: { elementId: Uuid; options: { optionId: Uuid; count: number }[] }[] }
        | { group: string; hidden: true }
    )[]
}

export type PollResults = {
    // สถานะโพล ณ ตอนดึงผล หน้าผลสดใช้หยุดดึงเมื่อโพลปิดแล้ว
    status: PollStatus
    totalBallots: number | null
    generatedAt: IsoDateTime
    elements: ElementResult[]
    breakdown?: Breakdown
}

// ไม่มีเวลาส่งหรือ id กำกับ ตั้งใจไม่ให้โยงกับคำตอบข้ออื่นของคนเดียวกันได้
export type TextAnswerPage = Page<{ text: string }>

// ระบุคนส่ง (GET /results/responses): หนึ่งแถวต่อผู้ตอบ · code null = บัญชีที่ไม่มีรหัสนิสิต/บุคลากร
export type Respondent = { code: string | null; submittedAt: IsoDateTime; answers: Answer[] }
export type RespondentPage = Page<Respondent>

// ฉบับร่างคำตอบที่ยังไม่ส่ง เก็บในเบราว์เซอร์เท่านั้น (src/lib/voteDraft.ts)
export type BallotDraft = { answers: Answer[]; savedAt: IsoDateTime }

// ── รูป ──

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp'

export type UploadTicket = {
    uploadUrl: string
    uploadHeaders: Record<string, string>
    publicUrl: string
    expiresInSeconds: number
}

// ── แอดมิน ──

export type AdminUser = {
    id: Uuid
    studentId: string | null
    cunexUserId: string | null
    facultyCode: string | null
    lastLoginAt: IsoDateTime | null
}

export type AuditLog = {
    id: string
    actorId: Uuid | null
    action: string
    entityType: string
    entityId: string
    data: Record<string, unknown>
    createdAt: IsoDateTime
}
