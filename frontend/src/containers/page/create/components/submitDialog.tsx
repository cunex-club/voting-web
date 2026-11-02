'use client'
import React from 'react'
import { Eye, Loader2, Send } from 'lucide-react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// review = โพลนี้ต้องรอผู้ดูแลอนุมัติ (เฉพาะทั้งจุฬาฯ) · ไม่ต้อง = ส่งแล้วเจ้าของกดเปิดโหวตได้เลย
export function SubmitDialog({ open, onOpenChange, onPreview, onSubmit, pending, error, review }: {
    open: boolean
    review: boolean
    onOpenChange: (open: boolean) => void
    onPreview: () => void
    onSubmit: () => void
    pending: boolean
    // problems = รายการที่ backend บอกว่ายังไม่ครบ (POLL_INCOMPLETE)
    error: { message: string; problems?: string[] } | null
}) {
    return (
        <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next) }}>
            <DialogContent>
                <div className='flex justify-center pt-4 flex-col items-center w-full'>
                    <Send className='text-primary size-14' />
                    <span className=' font-heading text-xl py-6 font-bold'>{review ? 'ยืนยันการส่งขออนุมัติ ?' : 'ยืนยันการส่งโพล ?'}</span>
                    <div className=' flex flex-col items-center'>
                        <span className=' text-center max-w-full text-base'>
                            {review ? (
                                <>โพลทั้งจุฬาฯ จะถูกส่งให้ผู้ดูแลระบบตรวจสอบ<br/>และอนุมัติก่อนนำไปใช้งาน หลังจากส่งแล้วแบบฟอร์ม<br/>จะอยู่ในสถานะ “รออนุมัติ”</>
                            ) : (
                                <>โพลนี้ไม่ต้องรอผู้ดูแลอนุมัติ หลังจากส่งแล้ว<br/>แก้เนื้อหาไม่ได้ และกดเปิดโหวตได้ที่หน้าโพล</>
                            )}
                        </span>
                        <button type='button' onClick={onPreview} className=' text-lg underline cursor-pointer font-bold'>ดูตัวอย่าง</button>
                    </div>
                    <div className='flex w-full gap-2 py-4'>
                        <Button variant={'outline'} className="flex-1 font-heading font-bold text-base" disabled={pending} onClick={() => onOpenChange(false)}>แก้ไขต่อ</Button>
                        <Button className='flex-1' onClick={onSubmit} disabled={pending} aria-busy={pending}>
                            {pending ? <Loader2 className='animate-spin' /> : <Send />}
                            <span className='font-heading font-bold text-base'>{review ? 'ส่งขออนุมัติ' : 'ส่งโพล'}</span>
                        </Button>
                    </div>
                </div>
                {error && (
                    <div role='alert' className='flex flex-col gap-1 text-base text-destructive'>
                        <p>{error.message}</p>
                        {error.problems && error.problems.length > 0 && (
                            <ul className='list-disc pl-5 text-sm'>
                                {error.problems.map((p) => <li key={p}>{p}</li>)}
                            </ul>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
