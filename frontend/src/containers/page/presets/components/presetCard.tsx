'use client'
import React, { useState } from 'react'
import { Bookmark, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { usePresetStore, type CodePreset } from '@/store/presetStore'
import { CODE_KIND_LABEL, PRESET_NAME_MAX } from '@/lib/codes'

// การ์ด preset: เปลี่ยนชื่อและลบได้ ทั้งสองอย่างยืนยันใน dialog ก่อน
export function PresetCard({ preset }: { preset: CodePreset }) {
    const rename = usePresetStore((s) => s.rename)
    const remove = usePresetStore((s) => s.remove)
    const [renameOpen, setRenameOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [name, setName] = useState(preset.name)
    const [error, setError] = useState<string | null>(null)

    const closeAll = () => {
        setRenameOpen(false)
        setDeleteOpen(false)
        setError(null)
        setName(preset.name)
    }

    return (
        <Card size='sm'>
            <CardContent className='flex flex-col gap-2'>
                <div className='flex min-w-0 flex-col'>
                    <span className='truncate font-heading text-lg font-bold'>{preset.name}</span>
                    <span className='text-base text-ink-500'>{CODE_KIND_LABEL[preset.codeKind]} · {preset.codes.length} รหัส</span>
                </div>
                <p className='break-all text-sm text-ink-500 line-clamp-2'>{preset.codes.join(', ')}</p>
                <div className='flex justify-end gap-3'>
                    <Button variant='link' className='px-0 text-base font-bold' onClick={() => setRenameOpen(true)}>แก้ไขชื่อ</Button>
                    <Button variant='link' className='px-0 text-base font-bold text-destructive' onClick={() => setDeleteOpen(true)}>ลบ</Button>
                </div>
            </CardContent>

            <Dialog open={renameOpen} onOpenChange={(next) => { if (!next) closeAll() }}>
                <DialogContent>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault()
                            if (!name.trim()) { setError('ต้องตั้งชื่อ preset'); return }
                            rename(preset.id, name.trim())
                            setRenameOpen(false)
                            setError(null)
                        }}
                        className='flex w-full flex-col items-center pt-4'
                    >
                        <Bookmark className='text-primary size-14' />
                        <DialogTitle className='font-heading text-xl py-6 font-bold'>แก้ไขชื่อ preset</DialogTitle>
                        <DialogDescription className='sr-only'>เปลี่ยนชื่อ preset นี้</DialogDescription>
                        <Input
                            className='my-2'
                            maxLength={PRESET_NAME_MAX}
                            value={name}
                            aria-invalid={error !== null}
                            onChange={(e) => { setName(e.target.value); setError(null) }}
                        />
                        {error && <p role='alert' className='mb-2 text-base text-destructive'>{error}</p>}
                        <div className='flex w-full gap-2 py-4'>
                            <Button type='button' variant='outline' className='flex-1 font-heading text-base font-bold' onClick={closeAll}>ยกเลิก</Button>
                            <Button type='submit' className='flex-1'>
                                <span className='font-heading text-base font-bold'>บันทึก</span>
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={deleteOpen} onOpenChange={(next) => { if (!next) closeAll() }}>
                <DialogContent>
                    <div className='flex w-full flex-col items-center pt-4'>
                        <Trash2 className='text-destructive size-14' />
                        <DialogTitle className='font-heading text-xl py-6 font-bold'>ลบ preset นี้ ?</DialogTitle>
                        <DialogDescription className='text-center text-base'>
                            “{preset.name}” จะถูกลบถาวร<br />โพลที่ใช้รหัสจาก preset นี้ไปแล้วจะไม่ได้รับผลกระทบ
                        </DialogDescription>
                        <div className='flex w-full gap-2 py-4'>
                            <Button variant='outline' className='flex-1 font-heading text-base font-bold' onClick={closeAll}>ยกเลิก</Button>
                            <Button variant='destructive' className='flex-1' onClick={() => remove(preset.id)}>
                                <Trash2 />
                                <span className='font-heading text-base font-bold'>ลบ</span>
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    )
}
