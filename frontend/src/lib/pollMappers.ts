import type { Audience, Element, ElementOption, PollDetail, PollDraft } from '@/api/types'
import type { ElementItem, FormItem, InputItem, Option } from '@/store/elementStore'
import type { CreatePollState } from '@/store/createPollStore'
import { parseCodes, type CodeKind } from '@/lib/codes'

// ตัวแปลงระหว่างโมเดลของหน้าสร้างโพล/หน้ากรอก (FormItem) กับ Element ของ API
// หน้าเว็บทำงานกับ FormItem ทั้งหมด แปลงที่ขอบตอนส่ง/รับจาก API ที่เดียว
//   radio → single_choice · checkbox → multi_choice · select → dropdown · text → text_question
//   text (element) → description · image → image · dialog → info_popup · accordion → accordion · pagebreak → page_break

// Omit ที่กระจายไปทีละสมาชิกของ union (Omit ปกติจะยุบ union ทิ้ง)
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

const nonEmpty = (v: string | null | undefined) => (v && v.trim() ? v : null)

function optionToApi(o: Option): ElementOption {
    return {
        label: o.label,
        imageUrl: o.imageUrl || null,
        imageAlt: nonEmpty(o.imageAlt),
        popup: o.info && (o.info.title || o.info.body)
            // ตัวเลือกไม่มีปุ่มเปิดข้อมูลแล้ว (กดตัวเลือก = เปิดรายละเอียด) จึงไม่ส่งข้อความบนปุ่ม
            ? { buttonText: null, title: o.info.title ?? '', body: o.info.body ?? '' }
            : null,
    }
}

function optionFromApi(o: ElementOption, fallbackId: string): Option {
    return {
        id: o.id ?? fallbackId,
        label: o.label,
        imageUrl: o.imageUrl ?? undefined,
        imageAlt: o.imageAlt ?? undefined,
        ...(o.popup && { info: { trigger: o.popup.buttonText ?? undefined, title: o.popup.title, body: o.popup.body } }),
    }
}

// เพดานที่ไม่น้อยกว่าจำนวนตัวเลือก = ไม่จำกัดอยู่แล้ว (เช่นลบตัวเลือกจนเหลือเท่าเพดาน) จึงไม่ส่ง
// ไม่งั้น backend ตีกลับตอนส่งขออนุมัติว่าเพดานมากกว่าจำนวนตัวเลือก
export function effectiveMaxSelect(item: { options: unknown[]; maxSelect?: number }) {
    return item.maxSelect !== undefined && item.maxSelect < item.options.length ? item.maxSelect : undefined
}

export function itemToElement(item: FormItem): Element {
    if (item.kind === 'input') {
        const base = { title: item.label, isRequired: item.required }
        switch (item.type) {
            case 'radio': return { ...base, type: 'single_choice', config: { layout: item.optionLayout ?? 'list' }, options: item.options.map(optionToApi) }
            case 'checkbox': return { ...base, type: 'multi_choice', config: { layout: item.optionLayout ?? 'list', maxSelect: effectiveMaxSelect(item) ?? null }, options: item.options.map(optionToApi) }
            case 'select': return { ...base, type: 'dropdown', config: {}, options: item.options.map(optionToApi) }
            case 'text': return { ...base, type: 'text_question', config: { placeholder: nonEmpty(item.placeholder), maxLength: item.maxLength ?? null } }
        }
    }
    switch (item.type) {
        case 'text': return { type: 'description', config: { showHeading: !!nonEmpty(item.title), align: item.align ?? 'left', sections: [{ heading: nonEmpty(item.title), body: item.body }] } }
        case 'image': return { type: 'image', config: { url: item.url || null, alt: nonEmpty(item.alt), caption: nonEmpty(item.caption) } }
        case 'dialog': return { type: 'info_popup', config: { buttonText: nonEmpty(item.trigger), title: item.title, body: item.body, imageUrl: item.imageUrl || null } }
        case 'accordion': return { type: 'accordion', config: { title: item.title, body: item.body } }
        case 'pagebreak': return { type: 'page_break', config: {} }
    }
}

// id ของ element จาก API ใช้เป็น id ของ FormItem ตรงๆ (หลังเปิดโหวต id คงที่ จึงใช้เป็น key ของคำตอบได้)
export function elementToItem(e: Element, index: number): FormItem {
    const id = e.id ?? `element-${index}`
    const input = (rest: DistOmit<InputItem, 'kind' | 'id' | 'label' | 'required'>): FormItem =>
        ({ kind: 'input', id, label: e.title ?? '', required: e.isRequired === true, ...rest }) as InputItem
    const element = (rest: DistOmit<ElementItem, 'kind' | 'id'>): FormItem => ({ kind: 'element', id, ...rest }) as ElementItem
    const options = (opts: ElementOption[]) => opts.map((o, i) => optionFromApi(o, `${id}-o${i}`))

    switch (e.type) {
        case 'single_choice': return input({ type: 'radio', options: options(e.options), optionLayout: e.config.layout })
        case 'multi_choice': return input({ type: 'checkbox', options: options(e.options), optionLayout: e.config.layout, maxSelect: e.config.maxSelect ?? undefined })
        case 'dropdown': return input({ type: 'select', options: options(e.options) })
        case 'text_question': return input({ type: 'text', placeholder: e.config.placeholder ?? undefined, maxLength: e.config.maxLength ?? undefined })
        case 'description': {
            // หน้าแก้ไขรองรับหัวข้อเดียว หลายส่วนจึงรวมเป็นก้อนเดียว
            const sections = e.config.sections ?? []
            return element({
                type: 'text',
                title: e.config.showHeading ? sections[0]?.heading ?? undefined : undefined,
                body: sections.map((s, i) => (i > 0 && s.heading ? `${s.heading}\n${s.body}` : s.body)).join('\n\n'),
                align: e.config.align ?? 'left',
            })
        }
        case 'image': return element({ type: 'image', url: e.config.url ?? '', alt: e.config.alt ?? undefined, caption: e.config.caption ?? undefined })
        case 'info_popup': return element({ type: 'dialog', trigger: e.config.buttonText ?? undefined, title: e.config.title, body: e.config.body, imageUrl: e.config.imageUrl ?? undefined })
        case 'accordion': return element({ type: 'accordion', title: e.config.title, body: e.config.body })
        case 'page_break': return element({ type: 'pagebreak' })
    }
}

// ระบุรหัส: ส่งทุกบรรทัดที่ไม่ว่าง backend ตรวจรูปแบบเอง (รหัสผิดรูปแบบ = บันทึกไม่ผ่าน พร้อมบอกว่ารหัสไหน)
export function audienceOfForm(form: Pick<CreatePollState, 'audienceType' | 'rules' | 'codesText'>): Audience {
    if (form.audienceType === 'restricted') return { type: 'restricted', rules: form.rules }
    if (form.audienceType === 'codes') return { type: 'codes', codes: parseCodes(form.codesText) }
    return { type: form.audienceType }
}

// ประเภทรหัสไม่ได้เก็บที่ backend ดูจากความยาวรหัสส่วนใหญ่แทน (บุคลากร 8 หลัก นิสิต 10 หลัก)
const codeKindOf = (codes: string[]): CodeKind =>
    codes.filter((c) => c.length === 8).length > codes.length / 2 ? 'STAFF' : 'STUDENT'

// ค่าฟอร์มหน้าสร้างโพล → body ของ POST/PUT /polls
export function formToDraft(form: CreatePollState, items: FormItem[]): PollDraft {
    return {
        title: form.title.trim(),
        description: form.desc.trim(),
        coverImageUrl: form.coverImageUrl,
        opensAt: form.openTime,
        closesAt: form.closeTime,
        audience: audienceOfForm(form),
        settings: {
            showResultsRealtime: form.realtime,
            allowAnswerEdit: form.allowAnswerEdit,
            listedPublicly: form.listedPublicly,
            // โพลสาธารณะระบุคนส่งไม่ได้ (backend ตีกลับ) สวิตช์ในฟอร์มอาจค้างค่าไว้จากตอนเลือกขอบเขตอื่น
            identifySender: form.audienceType !== 'public' && form.identifySender,
        },
        elements: items.map(itemToElement),
    }
}

// PollDetail ของฉบับร่าง → ค่าฟอร์ม + คำถาม (กลับทิศกับ formToDraft)
export function detailToForm(poll: PollDetail): { form: CreatePollState; items: FormItem[] } {
    return {
        form: {
            title: poll.title,
            desc: poll.description,
            openTime: poll.opensAt,
            closeTime: poll.closesAt,
            coverImageUrl: poll.coverImageUrl,
            audienceType: poll.audience.type,
            rules: poll.audience.type === 'restricted' ? poll.audience.rules : [],
            codeKind: codeKindOf(poll.audience.type === 'codes' ? poll.audience.codes ?? [] : []),
            codesText: poll.audience.type === 'codes' ? (poll.audience.codes ?? []).join('\n') : '',
            realtime: poll.settings.showResultsRealtime,
            allowAnswerEdit: poll.settings.allowAnswerEdit,
            listedPublicly: poll.settings.listedPublicly,
            identifySender: poll.settings.identifySender,
        },
        items: poll.elements.map(elementToItem),
    }
}
