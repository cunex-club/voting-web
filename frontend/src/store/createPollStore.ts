import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware"
import type { AudienceRule, AudienceType } from "@/api/types"
import type { CodeKind } from "@/lib/codes"

// ขอบเขตในฟอร์ม = ของ API + "codes" (ระบุรหัส) ที่ยังมีแค่ฝั่งเว็บ ตอนส่งไป backend จะเป็น chula (ดู audienceOfForm)
export type FormAudienceType = AudienceType | "codes"

type PollFormFields = {
    title: string
    desc: string
    // เก็บเป็น ISO string เพราะ persist เป็น JSON ไม่รองรับ Date · openTime null = เปิดทันทีที่กด Publish
    openTime: string | null
    closeTime: string | null
    // publicUrl จาก POST /images/uploads
    coverImageUrl: string | null
    // chula = ทั้งจุฬาฯ · restricted = เฉพาะคณะ/ปีเข้า · public = สาธารณะ (ทุกคนที่ล็อกอิน) · codes = ระบุรหัส
    audienceType: FormAudienceType
    // กฎของ restricted: studentYear null = ทุกปีเข้า
    rules: AudienceRule[]
    // ช่องของแบบ "ระบุรหัส": ประเภทรหัส และรหัสทีละบรรทัด (มีแค่ฝั่งเว็บ)
    codeKind: CodeKind
    codesText: string
    realtime: boolean
    allowAnswerEdit: boolean
    listedPublicly: boolean
    // ระบุคนส่ง: เจ้าของโพลเห็นรหัสผู้ตอบ (มีแค่ฝั่งเว็บ backend ยังไม่เก็บ) · โพลสาธารณะใช้ไม่ได้
    identifySender: boolean
}

export type CreatePollState = PollFormFields

type UseCreatePollStore = PollFormFields & {
    // ฟอร์มในเครื่องเป็นของฉบับร่างไหนบน server · null = โพลใหม่ที่ยังไม่เคยบันทึก
    // เก็บไว้กันเนื้อหาฉบับร่างที่ค้างในเครื่องไปโผล่เป็น "โพลใหม่" (บันทึกแล้วได้โพลซ้ำ)
    sourceId: string | null
    setSourceId: (id: string | null) => void
    update: (patch: Partial<PollFormFields>) => void
    reset: () => void
}

const INITIAL_FIELDS: PollFormFields = {
    title: "",
    desc: "",
    openTime: null,
    closeTime: null,
    coverImageUrl: null,
    audienceType: "chula",
    rules: [],
    codeKind: "STUDENT",
    codesText: "",
    realtime: false,
    allowAnswerEdit: true,
    listedPublicly: true,
    identifySender: false,
}

// เฉพาะค่าในฟอร์ม (ตัดฟังก์ชันและ sourceId ออก)
export function formFieldsOf(s: PollFormFields): PollFormFields {
    return Object.fromEntries(Object.keys(INITIAL_FIELDS).map((k) => [k, s[k as keyof PollFormFields]])) as PollFormFields
}

// อยู่ใน store และ persist ไว้ ร่างที่ยังไม่ได้กดบันทึกจะได้ไม่หายตอนรีเฟรช
export const useCreatePollStore = create<UseCreatePollStore>()(
    persist(
        (set) => ({
            ...INITIAL_FIELDS,
            sourceId: null,
            setSourceId: (sourceId) => set({ sourceId }),
            update: (patch) => set(patch),
            reset: () => set({ ...INITIAL_FIELDS, sourceId: null }),
        }),
        {
            name: 'poll-form-draft',
            storage: createJSONStorage(() => localStorage),
            partialize: (s) => {
                return { ...formFieldsOf(s), sourceId: s.sourceId }
            },
            // v2: เปลี่ยนตามสัญญา API v1 (scope A/B/C/D → audienceType) · v4: ตัดช่องที่ backend ไม่มี
            // v5: เอาช่องรหัสกับระบุคนส่งกลับมาเป็น UI ฝั่งเว็บ (ช่องที่ไม่มีในร่างเก่าได้ค่าเริ่มต้น)
            version: 5,
            migrate: (persisted, version) => {
                if (version >= 2) {
                    const p = persisted as Partial<PollFormFields> & { sourceId?: string | null }
                    const fields = Object.fromEntries(Object.keys(INITIAL_FIELDS).map((k) => [k, p[k as keyof PollFormFields]]).filter(([, v]) => v !== undefined))
                    return { ...INITIAL_FIELDS, ...fields, sourceId: p.sourceId ?? null } as PollFormFields
                }
                const old = persisted as { title?: string; desc?: string; closeTime?: string | null; scope?: string; realtime?: boolean; showExplore?: boolean }
                return {
                    ...INITIAL_FIELDS,
                    title: old.title ?? '',
                    desc: old.desc ?? '',
                    closeTime: old.closeTime ?? null,
                    audienceType: old.scope === 'C' ? 'public' : old.scope === 'B' ? 'restricted' : old.scope === 'D' ? 'codes' : 'chula',
                    realtime: old.realtime ?? false,
                    listedPublicly: old.showExplore ?? true,
                }
            },
        }
    )
)
