'use client'
import React from 'react'
import { ArrowRight, CircleCheck, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { AnonymityNote } from './anonymityNote'

// ยืนยันก่อนส่งคำตอบ ระหว่างส่งปิด dialog ไม่ได้ และปุ่มกดซ้ำไม่ได้
export function ConfirmSubmitModal({ open, onOpenChange, pollTitle, editing = false, identified = false, pending, onConfirm }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    pollTitle: string
    // แก้คำตอบที่ส่งไปแล้ว: ส่งใหม่จะแทนที่คำตอบเดิม
    editing?: boolean
    // โพลระบุคนส่ง: ย้ำอีกครั้งก่อนส่ง
    identified?: boolean
    pending: boolean
    onConfirm: () => void
}) {
    return (
        <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next) }}>
            <DialogContent>
                <div className='flex w-full flex-col items-center gap-2 pt-4'>
                    <CircleCheck className='size-14 text-primary' />
                    <DialogTitle className='pt-4 font-heading text-xl font-bold'>{editing ? 'ยืนยันการแก้คำตอบ ?' : 'ยืนยันการส่งคำตอบ ?'}</DialogTitle>
                    <DialogDescription className='text-center text-base break-words'>{pollTitle}</DialogDescription>
                    <div className='flex w-full flex-col gap-2 pt-4'>
                        <Button className='h-11 rounded-full font-heading text-base font-bold' disabled={pending} aria-busy={pending} onClick={onConfirm}>
                            {pending && <Loader2 className='animate-spin' />}
                            ส่งคำตอบ
                            {!pending && <ArrowRight />}
                        </Button>
                        <Button variant='outline' className='h-11 rounded-full font-heading text-base font-bold' disabled={pending} onClick={() => onOpenChange(false)}>
                            แก้ไขต่อ
                        </Button>
                    </div>
                    <AnonymityNote className='pt-2' identified={identified} />
                </div>
            </DialogContent>
        </Dialog>
    )
}
