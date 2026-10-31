import type { CreatePollState } from '@/store/createPollStore'

// ค่าตั้งของโพลที่ backend ยังไม่เก็บ (ขอบเขตแบบระบุรหัส และระบุคนส่ง) เก็บในเครื่องแยกตาม id ของโพล
// ไม่งั้นเปิดฉบับร่างอีกครั้ง ฟอร์มจะได้แค่ค่าจาก server แล้วค่าพวกนี้หาย
// ใช้ได้เฉพาะ browser เครื่องเดิม เปิดจากเครื่องอื่นจะไม่เห็น

const KEY = 'poll-local-extras'

export type PollLocalExtras = Pick<CreatePollState, 'codeKind' | 'codesText' | 'identifySender'> & { usesCodes: boolean }

function readAll(): Record<string, PollLocalExtras> {
    try {
        const raw = localStorage.getItem(KEY)
        return raw ? (JSON.parse(raw) as Record<string, PollLocalExtras>) : {}
    } catch {
        return {}
    }
}

function writeAll(all: Record<string, PollLocalExtras>) {
    try {
        localStorage.setItem(KEY, JSON.stringify(all))
    } catch {
        // เก็บไม่ได้ (เช่น private mode) ค่าพวกนี้จะหายตอนเปิดฉบับร่างใหม่ ไม่กระทบการบันทึกบน server
    }
}

export const readPollExtras = (pollId: string): PollLocalExtras | null => readAll()[pollId] ?? null

// ไม่ได้ใช้ฟีเจอร์ที่มีแค่ฝั่งเว็บเลย = ลบทิ้ง ไม่ให้ค้างในเครื่อง
export function savePollExtras(pollId: string, form: CreatePollState) {
    const all = readAll()
    const usesCodes = form.audienceType === 'codes'
    const identifySender = form.audienceType !== 'public' && form.identifySender
    if (!usesCodes && !identifySender) delete all[pollId]
    else all[pollId] = { usesCodes, codeKind: form.codeKind, codesText: usesCodes ? form.codesText : '', identifySender }
    writeAll(all)
}

// ค่าที่จะทับลงฟอร์มตอนเปิดฉบับร่าง · "ระบุรหัส" กลับมาได้เฉพาะเมื่อ server ยังเป็นทั้งจุฬาฯ (ไม่ได้ถูกเปลี่ยนจากที่อื่น)
export function extrasToForm(extras: PollLocalExtras | null, form: CreatePollState): Partial<CreatePollState> {
    if (!extras) return {}
    return {
        codeKind: extras.codeKind,
        codesText: extras.codesText,
        identifySender: extras.identifySender,
        ...(extras.usesCodes && form.audienceType === 'chula' ? { audienceType: 'codes' as const } : {}),
    }
}
