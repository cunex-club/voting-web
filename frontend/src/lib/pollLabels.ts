import type { PollStatus, PollSummary } from '@/api/types'
import type { FormAudienceType } from '@/store/createPollStore'

export const STATUS_LABEL: Record<PollStatus, string> = {
    draft: 'ฉบับร่าง',
    pending_review: 'รออนุมัติ',
    approved: 'อนุมัติแล้ว',
    open: 'กำลังโหวต',
    closed: 'จบแล้ว',
    rejected: 'ไม่อนุมัติ',
}

// สีชิปสถานะ ใช้ชุดเดียวกันทุกที่ที่แสดงสถานะโพล
// เขียว = กำลังรับคำตอบ, เหลือง = รอคนตัดสิน, ฟ้า = อนุมัติแล้วรอเปิด, แดง = ไม่อนุมัติ, เทา = ยังไม่เริ่ม/จบไปแล้ว
export const STATUS_BADGE_CLASS: Record<PollStatus, string> = {
    draft: 'bg-badge text-muted',
    pending_review: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-blue-100 text-blue-200',
    open: 'bg-green-100 text-green-200',
    closed: 'bg-badge text-muted',
    rejected: 'bg-red-100 text-red-200',
}

// codes = แบบ "ระบุรหัส" ที่มีแค่ในหน้าสร้างโพล (โพลจาก API ไม่มีชนิดนี้)
export const AUDIENCE_LABEL: Record<FormAudienceType, string> = {
    chula: 'ทั้งจุฬาฯ',
    restricted: 'เฉพาะคณะ/ปีเข้า',
    public: 'สาธารณะ',
    codes: 'ระบุรหัส',
}

export const AUDIENCE_DESCRIPTION: Record<FormAudienceType, string> = {
    chula: 'นิสิตและบุคลากรจุฬาฯ ที่ยืนยันตัวตนผ่าน CUNEX',
    restricted: 'เฉพาะคณะและปีเข้าที่เลือก ต้องยืนยันตัวตนผ่าน CUNEX',
    public: 'ทุกคนที่เข้าสู่ระบบ',
    codes: 'เฉพาะรหัสนิสิต/บุคลากรที่กำหนด',
}

// เฉพาะโพลทั้งจุฬาฯ ที่ต้องรอผู้ดูแลอนุมัติ (backend: needsReview) ขอบเขตอื่นส่งแล้วพร้อมเปิดโหวตเลย
// "ระบุรหัส" ยังส่งไป backend เป็นทั้งจุฬาฯ จึงต้องรออนุมัติด้วย
export const needsReview = (audience: FormAudienceType) => audience === 'chula' || audience === 'codes'

// ใช้ timeZone คงที่ เพื่อให้ server กับ client แสดงเวลาเหมือนกันตอน hydrate
const closeFormatter = new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
})

export function formatCloseTime(date: Date | string) {
    return closeFormatter.format(new Date(date))
}

// ความยาวสูงสุดของเหตุผลตอนปิดรับคำตอบก่อนกำหนด (สัญญา: ≤ 500)
export const CLOSE_REASON_MAX = 500

// เวลาปิดที่การ์ดควรโชว์: โพลที่ปิดก่อนกำหนดต้องโชว์เวลาที่ปิดจริง ไม่งั้นอ่านแล้วนึกว่ายังเปิดอยู่
// โพลที่เผยแพร่แล้วแต่ยังไม่ถึงเวลาเปิด โชว์เวลาเปิดแทน ไม่งั้นกดเข้าไปแล้วเจอว่ายังตอบไม่ได้
export function cardCloseLabel(poll: Pick<PollSummary, 'status' | 'opensAt' | 'closesAt' | 'closedAt' | 'closedEarly'>) {
    if (poll.closedEarly && poll.closedAt) return `ปิดก่อนกำหนด ${formatCloseTime(poll.closedAt)}`
    if (poll.status === 'open' && poll.opensAt && new Date(poll.opensAt).getTime() > Date.now()) return `เปิด ${formatCloseTime(poll.opensAt)}`
    return poll.closesAt ? `ปิด ${formatCloseTime(poll.closesAt)}` : 'ยังไม่ตั้งเวลาปิด'
}
