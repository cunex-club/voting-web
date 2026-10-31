import type { FormItem } from '@/store/elementStore'
import { useElementStore } from '@/store/elementStore'
import { type CreatePollState, formFieldsOf, useCreatePollStore } from '@/store/createPollStore'
import { extrasToForm, readPollExtras } from '@/lib/pollLocalExtras'

// ฟอร์มสร้างโพลในเครื่องมีชุดเดียว (persist ใน localStorage) ใช้ร่วมกันระหว่าง "โพลใหม่" กับ "แก้ฉบับร่าง"
// ไฟล์นี้ตัดสินว่าตอนเปิดหน้า create ฟอร์มที่ค้างอยู่เป็นของใคร
// - เปิดฉบับร่างทับโพลใหม่ที่ทำค้าง: พักโพลใหม่ไว้ก่อน กลับมาหน้าสร้างโพลใหม่แล้วได้คืน
// - เปิดหน้าสร้างโพลใหม่ตอนฟอร์มเป็นของฉบับร่าง (ออกไปโดยไม่ผ่าน dialog เช่นปิดแอป): ไม่เอาเนื้อหาฉบับร่างมาเป็นโพลใหม่

const STASH_KEY = 'poll-new-stash'

type Stash = { form: CreatePollState; items: FormItem[] }

function hasContent() {
    const f = useCreatePollStore.getState()
    return !!(f.title.trim() || f.desc.trim() || f.coverImageUrl || useElementStore.getState().items.length > 0)
}

function stashNewPoll() {
    const stash: Stash = { form: formFieldsOf(useCreatePollStore.getState()), items: useElementStore.getState().items }
    try {
        localStorage.setItem(STASH_KEY, JSON.stringify(stash))
    } catch {
        // เก็บไม่ได้ก็เปิดฉบับร่างต่อได้ โพลใหม่ที่ทำค้างจะหายเหมือนเดิม
    }
}

function takeStash(): Stash | null {
    try {
        const raw = localStorage.getItem(STASH_KEY)
        localStorage.removeItem(STASH_KEY)
        return raw ? (JSON.parse(raw) as Stash) : null
    } catch {
        return null
    }
}

// เรียกตอน mount หน้า create ก่อนลูกเรนเดอร์ · draft = ฉบับร่างที่จะแก้ (ไม่มี = โพลใหม่)
// loaded = ฉบับร่างนี้โหลดลงฟอร์มไปแล้วในรอบการใช้งานนี้ (เช่นกลับมาจากหน้าดูตัวอย่าง) ไม่ต้องโหลดทับ
export function prepareCreateForm(draft: { id: string; form: CreatePollState; items: FormItem[] } | undefined, loaded: boolean) {
    const poll = useCreatePollStore.getState()
    if (draft) {
        if (loaded) return
        if (!poll.sourceId && hasContent()) stashNewPoll()
        // server ไม่มีขอบเขตแบบระบุรหัสกับระบุคนส่ง เติมจากที่เก็บไว้ในเครื่อง
        poll.update({ ...draft.form, ...extrasToForm(readPollExtras(draft.id), draft.form) })
        poll.setSourceId(draft.id)
        useElementStore.setState({ items: draft.items })
        return
    }
    if (!poll.sourceId) return
    const stash = takeStash()
    poll.reset()
    useElementStore.setState({ items: stash?.items ?? [] })
    if (stash) poll.update(stash.form)
}
