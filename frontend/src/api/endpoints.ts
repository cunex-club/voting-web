import type { RequestOptions, Requester } from './client'
import type { AdminUser, AuditLog, Ballot, Faculty, ImageMime, Me, Page, PollDetail, PollDraft, PollPreview, PollResults, PollStatus, PollSummary, RespondentPage, ResultDisplay, TextAnswerPage, UploadTicket, Uuid } from './types'

// ทุก endpoint ในสัญญา api-endpoints v1 · หนึ่งฟังก์ชันต่อหนึ่ง endpoint ชื่อ/ลำดับหัวข้อตามเอกสาร
export function makeApi(req: Requester) {
    const signal = (s?: AbortSignal): Pick<RequestOptions, 'signal'> => ({ signal: s })
    const poll = (id: Uuid) => `/polls/${encodeURIComponent(id)}`

    return {
        // §1 Auth & session (หน้า login ใช้ลิงก์ใน authUrls แทน เพราะเป็นการ redirect ทั้งหน้า)
        auth: {
            logout: () => req<void>('/auth/logout', { method: 'POST' }),
            devLogin: (role: 'user' | 'admin') => req<Me>('/auth/dev/login', { method: 'POST', body: { role } }),
        },
        me: () => req<Me>('/me'),

        // §2 Reference data
        faculties: () => req<Faculty[]>('/faculties'),

        // §3 Polls — browse
        polls: {
            feed: (q: { status?: 'open' | 'closed'; cursor?: string | null; limit?: number } = {}) =>
                req<Page<PollSummary>>('/polls', { query: q }),
            mine: (q: { status?: PollStatus; cursor?: string | null; limit?: number } = {}) =>
                req<Page<PollSummary>>('/me/polls', { query: q }),
            get: (id: Uuid) => req<PollDetail>(poll(id)),
            // ไม่ต้อง login: หน้าแรกของโพลที่เปิดแล้ว สำหรับลิงก์แชร์
            preview: (id: Uuid) => req<PollPreview>(`${poll(id)}/preview`),

            // §4 Polls — authoring (owner)
            create: (draft: PollDraft) => req<PollDetail>('/polls', { method: 'POST', body: draft }),
            // แทนที่ฉบับร่างทั้งก้อน ต้องส่ง version ล่าสุดที่มี (412 VERSION_CONFLICT ถ้ามีคนแก้ก่อน)
            save: (id: Uuid, version: number, draft: PollDraft) =>
                req<PollDetail>(poll(id), { method: 'PUT', body: draft, headers: { 'If-Match': String(version) } }),
            remove: (id: Uuid) => req<void>(poll(id), { method: 'DELETE' }),
            submit: (id: Uuid) => req<PollDetail>(`${poll(id)}/submit`, { method: 'POST' }),
            setClosesAt: (id: Uuid, closesAt: string) => req<PollDetail>(`${poll(id)}/closes-at`, { method: 'PATCH', body: { closesAt } }),
            setRealtime: (id: Uuid, showResultsRealtime: boolean) =>
                req<PollDetail>(`${poll(id)}/realtime`, { method: 'PATCH', body: { showResultsRealtime } }),
            // now = เปิดรับคำตอบทันที · opensAt = เปิดตามเวลานี้ (เวลาใหม่ที่เลือกตอนกดเปิด) · ไม่ส่ง = ตาม opensAt ที่ตั้งไว้
            // backend บันทึก opensAt/openedAt เป็นเวลาที่เปิดจริงเสมอ
            publish: (id: Uuid, when: { now?: boolean; opensAt?: string } = {}) =>
                req<PollDetail>(`${poll(id)}/publish`, { method: 'POST', body: when }),
            // ตอบกลับเป็น PollDetail ทั้งก้อน ค่าที่บันทึกอยู่ใน .resultDisplay
            setResultDisplay: (id: Uuid, display: ResultDisplay) =>
                req<PollDetail>(`${poll(id)}/result-display`, { method: 'PUT', body: display }),
            close: (id: Uuid, reason?: string) => req<PollDetail>(`${poll(id)}/close`, { method: 'POST', body: reason ? { reason } : {} }),

            // §7 Results
            results: (id: Uuid, breakdown: 'none' | 'faculty' | 'year' = 'none', s?: AbortSignal) =>
                req<PollResults>(`${poll(id)}/results`, { query: { breakdown: breakdown === 'none' ? null : breakdown }, ...signal(s) }),
            textAnswers: (id: Uuid, elementId: Uuid, cursor?: string | null, limit = 20) =>
                req<TextAnswerPage>(`${poll(id)}/results/text`, { query: { elementId, cursor, limit } }),
            // ระบุคนส่ง: รหัสผู้ตอบคู่กับคำตอบ เฉพาะเจ้าของ/แอดมิน (ไฟล์ CSV ใช้ downloadUrls.responsesCsv)
            responses: (id: Uuid, cursor?: string | null, limit = 50) =>
                req<RespondentPage>(`${poll(id)}/results/responses`, { query: { cursor, limit } }),
        },

        // §5 Images
        images: {
            requestUpload: (mimeType: ImageMime, byteSize: number, s?: AbortSignal) =>
                req<UploadTicket>('/images/uploads', { method: 'POST', body: { mimeType, byteSize }, ...signal(s) }),
        },

        // §6 Ballots
        ballot: {
            get: (id: Uuid) => req<Ballot>(`${poll(id)}/ballot`),
            put: (id: Uuid, ballot: Pick<Ballot, 'answers'>) => req<Ballot>(`${poll(id)}/ballot`, { method: 'PUT', body: ballot }),
        },

        // §8 Admin
        admin: {
            polls: (q: { status?: PollStatus; cursor?: string | null; limit?: number } = {}) =>
                req<Page<PollSummary>>('/admin/polls', { query: q }),
            approve: (id: Uuid) => req<PollDetail>(`/admin${poll(id)}/approve`, { method: 'POST' }),
            reject: (id: Uuid, comment?: string) => req<PollDetail>(`/admin${poll(id)}/reject`, { method: 'POST', body: comment ? { comment } : {} }),
            takedown: (id: Uuid, reason: string) => req<PollDetail>(`/admin${poll(id)}/takedown`, { method: 'POST', body: { reason } }),
            admins: () => req<AdminUser[]>('/admin/admins'),
            addAdmin: (studentId: string) => req<AdminUser[]>('/admin/admins', { method: 'POST', body: { studentId } }),
            removeAdmin: (userId: Uuid) => req<void>(`/admin/admins/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
            auditLogs: (q: { entityType?: string; entityId?: string; cursor?: string | null } = {}) =>
                req<Page<AuditLog>>('/admin/audit-logs', { query: q }),
        },
    }
}

export type Api = ReturnType<typeof makeApi>
