'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { Bookmark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Dialog,
    DialogContent,
    DialogDescription,
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
import { useCreatePollStore } from '@/store/createPollStore'
import { usePresetStore } from '@/store/presetStore'
import { useGuardedNavigate } from '@/hooks/useGuardedNavigate'
import { useHydrated } from '@/hooks/useHydrated'
import { CODE_KIND_LABEL, CODE_PATTERNS, PRESET_NAME_MAX, parseCodes, type CodeKind } from '@/lib/codes'

// เครื่องมือ preset ใต้ช่องรายการรหัส: เลือก preset ที่บันทึกไว้, บันทึกรหัสปัจจุบันเป็น preset, ไปหน้าจัดการ
// preset เก็บในเครื่องนี้เท่านั้น (usePresetStore)
export function PresetTools() {
    const text = useCreatePollStore((s) => s.codesText)
    const codeKind = useCreatePollStore((s) => s.codeKind)
    const update = useCreatePollStore((s) => s.update)
    const presets = usePresetStore((s) => s.presets)
    const hydrated = useHydrated()
    const guard = useGuardedNavigate()

    const [pickedId, setPickedId] = useState('')
    const [saveOpen, setSaveOpen] = useState(false)

    const codes = parseCodes(text)
    const canSave = codes.length > 0 && codes.every((code) => CODE_PATTERNS[codeKind].test(code))
    const items = presets.map((p) => ({ label: `${p.name} · ${CODE_KIND_LABEL[p.codeKind]} ${p.codes.length} รหัส`, value: p.id }))

    return (
        <div className='flex flex-col gap-2 pt-1'>
            <div className='flex flex-wrap items-center gap-2'>
                <Button type='button' variant='outline' disabled={!canSave} onClick={() => setSaveOpen(true)}>
                    <Bookmark />
                    <span className='font-heading text-base font-bold'>บันทึกเป็น preset</span>
                </Button>
                <Link
                    href='/presets'
                    onClick={(e) => guard('/presets', e)}
                    className='text-base font-bold text-primary underline underline-offset-4'
                >
                    จัดการ preset
                </Link>
            </div>

            <div className='flex flex-col gap-1'>
                <Label className='font-bold text-base'>ใช้ preset ที่บันทึกไว้</Label>
                {hydrated && presets.length === 0 && <span className='text-sm text-ink-500'>ยังไม่มี preset</span>}
                {hydrated && presets.length > 0 && (
                    <Select
                        items={items}
                        value={pickedId}
                        onValueChange={(v) => {
                            const preset = presets.find((p) => p.id === v)
                            if (!preset) return
                            setPickedId(preset.id)
                            // ใช้ preset จะแทนรายการรหัสที่พิมพ์ค้างอยู่
                            update({ codeKind: preset.codeKind, codesText: preset.codes.join('\n') })
                        }}
                    >
                        <SelectTrigger className='w-full text-base h-10!'>
                            <SelectValue placeholder='เลือก preset' />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {items.map((item) => (
                                    <SelectItem className='text-base' key={item.value} value={item.value}>
                                        {item.label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                )}
            </div>

            <SavePresetDialog open={saveOpen} onOpenChange={setSaveOpen} codeKind={codeKind} codes={codes} />
        </div>
    )
}

// dialog ตั้งชื่อ preset หน้าตาเดียวกับ dialog ยืนยันการส่งโพล
function SavePresetDialog({ open, onOpenChange, codeKind, codes }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    codeKind: CodeKind
    codes: string[]
}) {
    const add = usePresetStore((s) => s.add)
    const [name, setName] = useState('')
    const [error, setError] = useState<string | null>(null)

    const handleOpenChange = (next: boolean) => {
        onOpenChange(next)
        if (!next) {
            setName('')
            setError(null)
        }
    }

    const submit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) {
            setError('ต้องตั้งชื่อ preset')
            return
        }
        add({ name: name.trim(), codeKind, codes })
        handleOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <form onSubmit={submit} className='flex w-full flex-col items-center pt-4'>
                    <Bookmark className='text-primary size-14' />
                    <DialogTitle className='font-heading text-xl py-6 font-bold'>บันทึกเป็น preset ?</DialogTitle>
                    <DialogDescription className='text-center text-base'>
                        ตั้งชื่อเพื่อเรียกใช้ซ้ำในโพลอื่น<br />preset เก็บไว้ในเครื่องนี้ · {CODE_KIND_LABEL[codeKind]} {codes.length} รหัส
                    </DialogDescription>
                    <Input
                        className='my-4'
                        placeholder='ชื่อ preset...'
                        maxLength={PRESET_NAME_MAX}
                        value={name}
                        aria-invalid={error !== null}
                        onChange={(e) => { setName(e.target.value); setError(null) }}
                    />
                    {error && <p role='alert' className='mb-2 text-base text-destructive'>{error}</p>}
                    <div className='flex w-full gap-2 py-4'>
                        <Button type='button' variant='outline' className='flex-1 font-heading text-base font-bold' onClick={() => handleOpenChange(false)}>
                            ยกเลิก
                        </Button>
                        <Button type='submit' className='flex-1'>
                            <Bookmark />
                            <span className='font-heading text-base font-bold'>บันทึก</span>
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
