'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage, isApiError } from '@/api'
import { Button } from '@/components/ui/button'
import { ReasonDialog } from './reasonDialog'

// footer ของแอดมินสำหรับโพลที่รออนุมัติ: ยืนยัน = approve, ปฏิเสธ = reject พร้อมความเห็นให้เจ้าของแก้แล้วส่งใหม่
export function ReviewFooter({ pollId }: { pollId: string }) {
    const router = useRouter()
    const [approving, setApproving] = useState(false)
    const [rejectOpen, setRejectOpen] = useState(false)

    const approve = async () => {
        setApproving(true)
        try {
            await api.admin.approve(pollId)
            toast.success('อนุมัติแล้ว รอเจ้าของโพลกดเปิดโหวต')
            router.refresh()
        } catch (err) {
            toast.error(isApiError(err, 'CLOSES_AT_PASSED') ? 'เลยเวลาปิดโหวตไปแล้วระหว่างรออนุมัติ อนุมัติไม่ได้' : errorMessage(err, 'อนุมัติไม่สำเร็จ'))
        } finally {
            setApproving(false)
        }
    }

    const reject = async (comment: string) => {
        try {
            await api.admin.reject(pollId, comment || undefined)
            setRejectOpen(false)
            toast.success('ปฏิเสธแล้ว เจ้าของโพลจะเห็นความเห็นนี้')
            router.refresh()
            return null
        } catch (err) {
            return errorMessage(err, 'ปฏิเสธไม่สำเร็จ')
        }
    }

    return (
        <footer data-bottom-bar className='sticky bottom-0 mt-auto flex gap-2 border-t bg-background py-3'>
            <Button variant='destructive' className='flex-1' disabled={approving} onClick={() => setRejectOpen(true)}>
                <X />
                <span className='font-heading text-base font-bold'>ปฏิเสธ</span>
            </Button>
            <Button className='flex-1' disabled={approving} aria-busy={approving} onClick={approve}>
                {approving ? <Loader2 className='animate-spin' /> : <Check />}
                <span className='font-heading text-base font-bold'>ยืนยัน</span>
            </Button>
            <ReasonDialog
                open={rejectOpen}
                onOpenChange={setRejectOpen}
                icon={X}
                title='ปฏิเสธโพลนี้ ?'
                description='เจ้าของโพลจะเห็นความเห็นนี้ แล้วแก้ไขส่งใหม่ได้'
                label='ความเห็นถึงเจ้าของโพล (ไม่บังคับ)'
                placeholder='เช่น ช่วยระบุวันจัดกิจกรรมในคำอธิบาย'
                max={1000}
                confirmLabel='ปฏิเสธ'
                onConfirm={reject}
            />
        </footer>
    )
}
