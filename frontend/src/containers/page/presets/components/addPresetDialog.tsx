'use client'
import React, { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { usePresetStore } from '@/store/presetStore'
import { CODE_KIND_ITEMS, CODE_KIND_LABEL, CODE_LENGTH, CODE_PATTERNS, CODE_PLACEHOLDER, PRESET_NAME_MAX, parseCodes, type CodeKind } from '@/lib/codes'

// ปุ่มลอยมุมขวาล่างแบบเดียวกับ "เพิ่ม admin" เปิด dialog ให้ตั้งชื่อ เลือกประเภทรหัส และวางรายการรหัส
export function AddPresetDialog() {
    const add = usePresetStore((s) => s.add)
    const [open, setOpen] = useState(false)
    const [name, setName] = useState('')
    const [codeKind, setCodeKind] = useState<CodeKind>('STUDENT')
    const [codesText, setCodesText] = useState('')
    const [error, setError] = useState<string | null>(null)

    const codes = parseCodes(codesText)
    const invalid = codes.filter((code) => !CODE_PATTERNS[codeKind].test(code))

    const handleOpenChange = (next: boolean) => {
        setOpen(next)
        if (!next) {
            setName('')
            setCodeKind('STUDENT')
            setCodesText('')
            setError(null)
        }
    }

    const submit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) return setError('ต้องตั้งชื่อ preset')
        if (codes.length === 0) return setError('ต้องมีรหัสอย่างน้อยหนึ่งรหัส')
        if (invalid.length > 0) {
            return setError(`รหัส${CODE_KIND_LABEL[codeKind]}ต้องเป็นตัวเลข ${CODE_LENGTH[codeKind]} หลักทุกบรรทัด`)
        }
        add({ name: name.trim(), codeKind, codes })
        handleOpenChange(false)
    }

    return (
        <>
            <Button className='fixed bottom-4 right-4 px-4 font-heading text-lg font-bold' onClick={() => setOpen(true)}>
                <Plus className='size-5' />
                เพิ่ม preset
            </Button>
            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent>
                    <form onSubmit={submit} className='flex flex-col gap-4'>
                        <DialogHeader>
                            <DialogTitle className='font-heading text-xl font-bold'>เพิ่ม preset</DialogTitle>
                            <DialogDescription className='text-base'>บันทึกรายการรหัสไว้เลือกใช้ซ้ำตอนสร้างโพลแบบระบุรหัส</DialogDescription>
                        </DialogHeader>
                        <div className='flex flex-col gap-1'>
                            <Label htmlFor='preset-name' className='text-base font-bold'>ชื่อ preset</Label>
                            <Input
                                id='preset-name'
                                placeholder='ชื่อ preset...'
                                maxLength={PRESET_NAME_MAX}
                                value={name}
                                onChange={(e) => { setName(e.target.value); setError(null) }}
                            />
                        </div>
                        <div className='flex flex-col gap-1'>
                            <Label className='text-base font-bold'>ประเภทรหัส</Label>
                            <Select
                                items={CODE_KIND_ITEMS}
                                value={codeKind}
                                onValueChange={(v) => { if (v) { setCodeKind(v as CodeKind); setError(null) } }}
                            >
                                <SelectTrigger className='h-10! w-full text-base'>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {CODE_KIND_ITEMS.map((item) => (
                                            <SelectItem key={item.value} value={item.value} className='text-base'>{item.label}</SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className='flex flex-col gap-1'>
                            <Label htmlFor='preset-codes' className='text-base font-bold'>รายการรหัส{CODE_KIND_LABEL[codeKind]}</Label>
                            <Textarea
                                id='preset-codes'
                                rows={6}
                                placeholder={CODE_PLACEHOLDER[codeKind]}
                                value={codesText}
                                aria-invalid={invalid.length > 0}
                                onChange={(e) => { setCodesText(e.target.value); setError(null) }}
                                className='max-h-60'
                            />
                            <span className='text-sm text-ink-500'>
                                ใส่รหัส {CODE_LENGTH[codeKind]} หลักหนึ่งรหัสต่อหนึ่งบรรทัด · {codes.length} รหัส
                                {invalid.length > 0 && <span className='text-destructive'> · ไม่ถูกรูปแบบ {invalid.length} รายการ</span>}
                            </span>
                        </div>
                        {error && <p role='alert' className='text-base text-destructive'>{error}</p>}
                        <DialogFooter>
                            <Button type='button' variant='outline' className='w-26 font-heading font-bold' onClick={() => handleOpenChange(false)}>ยกเลิก</Button>
                            <Button type='submit' className='w-26 font-heading font-bold'>บันทึก</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
