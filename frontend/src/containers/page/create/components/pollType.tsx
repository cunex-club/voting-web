'use client'
import React from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AUDIENCE_DESCRIPTION, AUDIENCE_LABEL, needsReview } from '@/lib/pollLabels'
import { CODE_KIND_ITEMS, CODE_KIND_LABEL, CODE_LENGTH, CODE_PATTERNS, CODE_PLACEHOLDER, parseCodes, type CodeKind } from '@/lib/codes'
import { useShallow } from 'zustand/react/shallow'
import { useCreatePollStore, type FormAudienceType } from '@/store/createPollStore'
import { FacultyPicker } from './facultyPicker'
import { PresetTools } from './presetTools'

const items: { label: string; value: FormAudienceType }[] = [
  { label: AUDIENCE_LABEL.chula, value: "chula" },
  { label: AUDIENCE_LABEL.restricted, value: "restricted" },
  { label: AUDIENCE_LABEL.public, value: "public" },
  { label: AUDIENCE_LABEL.codes, value: "codes" },
]

// ขอบเขตผู้ตอบ: ทั้งจุฬาฯ / เฉพาะคณะ-ปีเข้า / สาธารณะ / ระบุรหัส
export function PollType() {
    const audienceType = useCreatePollStore((s) => s.audienceType)
    const update = useCreatePollStore((s) => s.update)

    return (
        <div className='flex flex-col gap-1'>
            <Label className="text-xl font-heading font-bold">ประเภทโพล</Label>
            <Select items={items} value={audienceType} onValueChange={(v) => v && update({ audienceType: v as FormAudienceType })}>
                <SelectTrigger className="w-full text-base h-10!">
                    <SelectValue placeholder="เลือกประเภทโพล" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                    <SelectLabel>เลือกประเภทโพล</SelectLabel>
                    {items.map((item) => (
                        <SelectItem className={`text-base `} key={item.value} value={item.value}>
                        {item.label}
                        </SelectItem>
                    ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            <span className='text-sm text-ink-500'>
                {AUDIENCE_DESCRIPTION[audienceType]}
                {needsReview(audienceType) ? ' · ต้องรอผู้ดูแลอนุมัติก่อนเปิดโหวต' : ' · ไม่ต้องรอผู้ดูแลอนุมัติ'}
            </span>
            {audienceType === 'restricted' && <FacultyPicker />}
            {audienceType === 'codes' && <CodeListInput />}
        </div>
    )
}

// รายการรหัสของแบบ "ระบุรหัส" · ตอนนี้เป็น UI ฝั่งเว็บ backend ยังไม่ตรวจสิทธิ์จากรหัส
function CodeListInput() {
    const text = useCreatePollStore((s) => s.codesText)
    const codeKind = useCreatePollStore((s) => s.codeKind)
    const update = useCreatePollStore((s) => s.update)
    const codes = parseCodes(text)
    const invalid = codes.filter((code) => !CODE_PATTERNS[codeKind].test(code))

    return (
        <div className='flex flex-col gap-2 mt-2'>
            <div className='flex flex-col gap-1'>
                <Label className='font-bold text-base'>ประเภทรหัส</Label>
                <Select items={CODE_KIND_ITEMS} value={codeKind} onValueChange={(v) => v && update({ codeKind: v as CodeKind })}>
                    <SelectTrigger className='w-full text-base h-10!'>
                        <SelectValue placeholder='เลือกประเภทรหัส' />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {CODE_KIND_ITEMS.map((item) => (
                                <SelectItem className='text-base' key={item.value} value={item.value}>
                                    {item.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>
            <Label htmlFor='poll-codes' className='font-bold text-base'>รายการรหัส{CODE_KIND_LABEL[codeKind]}</Label>
            <Textarea
                id='poll-codes'
                value={text}
                onChange={(e) => update({ codesText: e.target.value })}
                placeholder={CODE_PLACEHOLDER[codeKind]}
                aria-invalid={invalid.length > 0}
                rows={6}
                className='max-h-60'
            />
            <span className='text-sm text-ink-500'>
                ใส่รหัส {CODE_LENGTH[codeKind]} หลักหนึ่งรหัสต่อหนึ่งบรรทัด · {codes.length} รหัส
                {invalid.length > 0 && <span className='text-destructive'> · ไม่ถูกรูปแบบ {invalid.length} รายการ</span>}
            </span>
            <PresetTools />
        </div>
    )
}

// สวิตช์ตั้งค่าโพล · โพลสาธารณะล็อกระบุคนส่งไว้ที่ปิด
export function PollTypeMore() {
    // useShallow: selector คืน object ใหม่ทุกครั้ง ต้องเทียบแบบตื้นไม่งั้นวน render
    const f = useCreatePollStore(useShallow((s) => ({
        audienceType: s.audienceType, realtime: s.realtime, allowAnswerEdit: s.allowAnswerEdit,
        listedPublicly: s.listedPublicly, identifySender: s.identifySender,
    })))
    const update = useCreatePollStore((s) => s.update)
    const isPublic = f.audienceType === 'public'

    const rows: { key: 'realtime' | 'allowAnswerEdit' | 'listedPublicly' | 'identifySender'; label: string; checked: boolean; disabled?: boolean; hint: string }[] = [
        { key: 'realtime', label: 'แสดงผลแบบเรียลไทม์', checked: f.realtime, hint: 'ผู้ที่ตอบแล้วดูผลระหว่างเปิดโหวตได้ (เปลี่ยนได้จนกว่าจะเปิดโหวต)' },
        { key: 'allowAnswerEdit', label: 'แก้คำตอบได้', checked: f.allowAnswerEdit, hint: 'หนึ่งคนหนึ่งคำตอบ แต่กลับมาแก้คำตอบของตัวเองได้จนกว่าจะปิดโหวต' },
        { key: 'listedPublicly', label: 'แสดงในหน้ารวมโพล', checked: f.listedPublicly, hint: 'ปิดไว้ = เข้าได้ทางลิงก์หรือ QR เท่านั้น' },
        {
            key: 'identifySender', label: 'ระบุคนส่ง', checked: !isPublic && f.identifySender, disabled: isPublic,
            hint: isPublic ? 'โพลสาธารณะไม่ระบุคนส่ง' : 'เปิดแล้วคุณจะเห็นรหัสของผู้ตอบคู่กับคำตอบ เช่น ใช้ทำแบบทดสอบ ผู้ตอบจะได้รับแจ้งก่อนเริ่มตอบ',
        },
    ]

    return (
        <div className='flex flex-col gap-2 py-2'>
            {rows.map((r) => (
                <div key={r.key} className='flex flex-col'>
                    <div className="flex gap-1 items-center">
                        <Switch id={`poll-${r.key}`} checked={r.checked} disabled={r.disabled} onCheckedChange={(v) => update({ [r.key]: v })} />
                        <Label htmlFor={`poll-${r.key}`} className=' text-base font-bold font-heading'>{r.label}</Label>
                    </div>
                    <span className='text-sm text-ink-500'>{r.hint}</span>
                </div>
            ))}
        </div>
    )
}
