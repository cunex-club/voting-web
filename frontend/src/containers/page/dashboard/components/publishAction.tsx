'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, Loader2, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage, isApiError } from '@/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DateTimePicker } from '@/components/common/dateTimePicker'
import { formatThaiDateTime } from '@/lib/thaiDate'
import { cn } from '@/lib/utils'

type Pending = 'scheduled' | 'now' | null

// ปุ่ม "เปิดโหวต" ของโพลที่อนุมัติแล้ว (POST /publish) เจ้าของเป็นคนกด · approved → open
// dialog มี 3 ทาง: เปิดตามเวลาเปิด / เปิดตอนนี้ / ยกเลิก
// ผู้สร้างตั้งเวลาเปิดไว้ตอนสร้างโพล (และยังไม่ถึง) = ใช้เวลานั้นเลย ไม่ต้องตั้งซ้ำ · ไม่ได้ตั้งหรือเลยไปแล้ว = เลือกเวลาในนี้
// backend บันทึกเวลาที่เปิดจริงลง opensAt เสมอ · โพลที่ตั้งเวลาไว้ขึ้นรายการทันทีแต่รับคำตอบตอนถึงเวลา
// expired = เลยเวลาปิดแล้ว ต้องเลื่อนเวลาปิดก่อน (backend ตอบ 422 CLOSES_AT_PASSED)
export function PublishAction({ pollId, opensAt, closesAt, expired, owner }: {
    pollId: string
    opensAt: string | null
    closesAt: string | null
    expired: boolean
    owner: boolean
}) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [pending, setPending] = useState<Pending>(null)
    const [error, setError] = useState<string | null>(null)
    // เวลาเปิดที่จะใช้: ตั้งต้นจากที่บันทึกไว้ (ถ้ายังไม่ผ่าน) แก้ได้ในหน้าต่างนี้
    const [when, setWhen] = useState<Date | undefined>(undefined)
    // มีเวลาเปิดที่ผู้สร้างตั้งไว้และยังไม่ถึง: แสดงเฉยๆ ไม่ต้องเลือกใหม่
    const [presetTime, setPresetTime] = useState(false)
    // เวลาปัจจุบัน ณ ตอนเปิดหน้าต่าง ใช้ตรวจเวลาที่เลือก (backend ตรวจซ้ำด้วยเวลาจริงตอนกด)
    const [shownAt, setShownAt] = useState(0)

    const openDialog = () => {
        // คิดตอนเปิดหน้าต่าง ไม่ใช่ตอน render เผื่อเปิดหน้าทิ้งไว้จนเลยเวลาที่ตั้ง
        const now = Date.now()
        const saved = opensAt ? new Date(opensAt) : undefined
        const upcoming = !!saved && saved.getTime() > now
        setShownAt(now)
        setPresetTime(upcoming)
        setWhen(upcoming ? saved : undefined)
        setError(null)
        setOpen(true)
    }

    // เวลาที่เลือกต้องอยู่ในอนาคตและก่อนเวลาปิด (backend ตรวจซ้ำ)
    const whenProblem = !when
        ? null
        : when.getTime() <= shownAt
            ? 'เวลาเปิดต้องอยู่ในอนาคต'
            : closesAt && when.getTime() >= new Date(closesAt).getTime()
                ? 'เวลาเปิดต้องอยู่ก่อนเวลาปิดโหวต'
                : null
    const canSchedule = !!when && !whenProblem

    const publish = async (mode: Exclude<Pending, null>) => {
        setPending(mode)
        setError(null)
        try {
            await api.polls.publish(pollId, mode === 'now' ? { now: true } : { opensAt: when!.toISOString() })
            setOpen(false)
            toast.success(mode === 'now'
                ? 'เปิดโหวตแล้ว แชร์ลิงก์ให้ผู้ตอบได้เลย'
                : `ตั้งเปิดโหวตแล้ว เริ่มรับคำตอบ ${formatThaiDateTime(when!)}`)
            router.refresh()
        } catch (err) {
            setError(isApiError(err, 'CLOSES_AT_PASSED') ? 'เลยเวลาปิดโหวตแล้ว เลื่อนเวลาปิดก่อนเปิดโหวต' : errorMessage(err, 'เปิดโหวตไม่สำเร็จ'))
        } finally {
            setPending(null)
        }
    }

    const message = !owner
        ? 'โพลนี้พร้อมเปิดโหวตแล้ว รอเจ้าของโพลกดเปิดโหวต'
        : expired
            ? 'เลยเวลาปิดโหวตที่ตั้งไว้แล้ว เลื่อนเวลาปิดด้านบนก่อนจึงจะเปิดโหวตได้'
            : 'โพลนี้พร้อมเปิดโหวตแล้ว กดเปิดโหวตเมื่อพร้อมให้เริ่มรับคำตอบ'

    const pill = 'h-11 w-full rounded-full font-heading text-base font-bold'

    return (
        <div className='flex flex-col gap-3 rounded-2xl bg-inner-bg px-4 py-6 text-center'>
            <p className='text-ink-500'>{message}</p>
            {owner && !expired && (
                <Button className={pill} onClick={openDialog}>
                    <Rocket />
                    เปิดโหวต
                </Button>
            )}

            {/* dialog ยืนยันหน้าตาเดียวกับยืนยันการส่งขออนุมัติ */}
            <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next) }}>
                <DialogContent>
                    <div className='flex w-full flex-col items-center pt-4'>
                        <Rocket className='size-14 text-primary' />
                        <DialogTitle className='py-6 font-heading text-xl font-bold'>เปิดโหวต ?</DialogTitle>
                        <DialogDescription className='text-center text-base'>
                            เลือกเวลาที่จะเริ่มรับคำตอบ <br />
                            หลังเปิดแล้วเปลี่ยนการแสดงผลแบบเรียลไทม์ไม่ได้
                        </DialogDescription>

                        <div className='flex w-full flex-col gap-2 py-4'>
                            {/* 1. เปิดตามเวลาเปิด: เลือกเวลาได้ในกล่องนี้ โพลขึ้นรายการทันที รับคำตอบเมื่อถึงเวลา */}
                            <section aria-labelledby='publish-scheduled' className='flex flex-col gap-3 rounded-2xl border border-primary/40 p-3 text-left'>
                                <span id='publish-scheduled' className='flex items-center gap-2 font-heading font-bold'>
                                    <CalendarClock className='size-5 text-primary' />
                                    เวลาเปิดโหวต
                                </span>
                                {presetTime && when ? (
                                    <p className='flex flex-col'>
                                        <span className='font-bold'>{formatThaiDateTime(when)}</span>
                                        <span className='text-sm text-ink-500'>ตามที่ตั้งไว้ตอนสร้างโพล โพลจะขึ้นรายการทันที และเริ่มรับคำตอบเมื่อถึงเวลานี้</span>
                                    </p>
                                ) : (
                                    <>
                                        <DateTimePicker value={when} onChange={setWhen} defaultTime='08:00' disabled={!!pending} />
                                        {whenProblem && <p role='alert' className='text-sm text-destructive'>{whenProblem}</p>}
                                        {!when && (
                                            <p className='text-sm text-ink-500'>
                                                {opensAt ? 'เวลาเปิดที่ตั้งไว้ผ่านไปแล้ว เลือกเวลาใหม่' : 'ยังไม่ได้ตั้งเวลาเปิด เลือกวันและเวลา'}ก่อนกดเปิดตามเวลา
                                            </p>
                                        )}
                                    </>
                                )}
                                <Button
                                    variant='outline'
                                    className={cn(pill, 'border-primary text-primary')}
                                    disabled={!canSchedule || !!pending}
                                    aria-busy={pending === 'scheduled'}
                                    onClick={() => publish('scheduled')}
                                >
                                    {pending === 'scheduled' ? <Loader2 className='animate-spin' /> : <CalendarClock />}
                                    เปิดตามเวลาเปิด
                                </Button>
                            </section>

                            {/* 2. เปิดตอนนี้ */}
                            <Button className={pill} disabled={!!pending} aria-busy={pending === 'now'} onClick={() => publish('now')}>
                                {pending === 'now' ? <Loader2 className='animate-spin' /> : <Rocket />}
                                เปิดตอนนี้
                            </Button>

                            {/* 3. ยกเลิก */}
                            <Button variant='ghost' className={pill} disabled={!!pending} onClick={() => setOpen(false)}>
                                ยกเลิก
                            </Button>
                        </div>
                    </div>
                    {error && <p role='alert' className='text-base text-destructive'>{error}</p>}
                </DialogContent>
            </Dialog>
        </div>
    )
}
