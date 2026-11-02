'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Ban, CheckCircle2, IdCard, List, Loader2, LogIn, Timer } from 'lucide-react'
import { toast } from 'sonner'
import { api, authUrls, errorMessage } from '@/api'
import { Button, buttonVariants } from '@/components/ui/button'
import { estimateMinutes, fromBallot, isBeforeOpening, isOpenForVoting, paginate, questionsOf, resumePageIndex, type Answers, type IneligibleReason, type VoterPoll } from '@/lib/voteForm'
import { readDraft, writeDraft } from '@/lib/voteDraft'
import { formatThaiDateTime, formatTimeLeftShort } from '@/lib/thaiDate'
import { cn } from '@/lib/utils'
import { AudienceScopeView } from '@/components/common/audienceScopeView'

const pill = 'h-11 w-full rounded-full font-heading text-base font-bold'
const outlinePill = cn(buttonVariants({ variant: 'outline' }), pill, 'border-primary text-primary')

// วันที่แบบตัวเลข พ.ศ. "15/10/2569 (14:30)"
const savedDate = new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Bangkok' })
const savedTime = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' })

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <dt className='text-sm text-ink-500'>{label}</dt>
            <dd className='pl-2'>{children}</dd>
        </div>
    )
}

// การ์ดหน้าแรกของโพล ปุ่มด้านล่างเปลี่ยนตามสถานะคำตอบของผู้ใช้และสถานะโพล
// ฉบับร่างคำตอบอยู่ในเบราว์เซอร์ (src/lib/voteDraft.ts) จึงอ่านหลัง mount
// onStart ส่งมาเมื่อเป็นหน้าดูตัวอย่าง: ไปหน้าคำถามในหน้าเดียวกัน ไม่สร้างร่าง
export function PollIntroCard({ poll, reason, onStart }: {
    poll: VoterPoll
    reason: IneligibleReason | null
    onStart?: () => void
}) {
    const router = useRouter()
    const [expanded, setExpanded] = useState(false)
    const [starting, setStarting] = useState(false)
    const [draft, setDraft] = useState<{ answers: Answers; savedAt: string } | null>(null)

    useEffect(() => {
        if (onStart) return
        const saved = readDraft(poll.id)
        // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage อ่านได้หลัง mount เท่านั้น
        if (saved) setDraft({ answers: fromBallot(questionsOf(poll.items), saved), savedAt: saved.savedAt })
    }, [poll.id, poll.items, onStart])

    // เริ่มโหวต = สร้างร่างว่าง · แก้คำตอบ = สร้างร่างจากคำตอบเดิม
    // หน้าคำถามเข้าได้เฉพาะตอนมีร่าง (เข้าตรงโดยไม่มีร่างจะถูกส่งกลับหน้านี้)
    const start = async (fromServer = false) => {
        if (onStart) return onStart()
        setStarting(true)
        try {
            const answers = fromServer ? (await api.ballot.get(poll.id)).answers : []
            writeDraft(poll.id, answers)
            router.push(`/${poll.id}/q/1`)
        } catch (err) {
            toast.error(errorMessage(err, 'เริ่มโหวตไม่สำเร็จ'))
            router.refresh()
            setStarting(false)
        }
    }
    const resumePage = draft ? resumePageIndex(paginate(poll.items), draft.answers) + 1 : 1

    const closedEarly = poll.closedEarly && poll.closedAt !== null
    const myAnswers = poll.submitted && <Link href={`/${poll.id}/my-answers`} className={outlinePill}>ดูคำตอบของคุณ</Link>
    const results = poll.canViewResults && <Link href={`/${poll.id}/results`} className={outlinePill}>ดูผลโหวต</Link>
    const startButton = (label: string, fromServer = false) => (
        <Button className={pill} disabled={starting} aria-busy={starting} onClick={() => start(fromServer)}>
            {starting && <Loader2 className='animate-spin' />}
            {label}
        </Button>
    )

    // ยังไม่ login: บอกสถานะโพลไว้ก่อน แล้วให้เข้าสู่ระบบด้วย CUNEX กลับมาหน้านี้
    const loginButton = (label: string) => (
        <a href={authUrls.cunex(`/${poll.id}`)} className={cn(buttonVariants(), pill)}>
            <LogIn />
            {label}
        </a>
    )

    let actions: React.ReactNode
    if (reason === 'LOGIN_REQUIRED') {
        const notYet = isBeforeOpening(poll)
        const ended = !notYet && !isOpenForVoting(poll)
        actions = (
            <>
                {ended && <Button disabled className={pill}>{closedEarly ? 'ถูกปิดก่อนกำหนด' : 'ปิดโหวตแล้ว'}</Button>}
                {notYet && <Button disabled className={pill}>เปิดโหวต {formatThaiDateTime(poll.opensAt!)}</Button>}
                {loginButton(ended ? 'เข้าสู่ระบบ' : 'เข้าสู่ระบบเพื่อโหวต')}
                <p className='text-center text-sm text-ink-500'>เข้าสู่ระบบด้วยบัญชี CUNEX (CUNET) ของจุฬาฯ</p>
            </>
        )
    } else if (reason === 'NOT_OPEN') {
        actions = <Button disabled className={pill}>โพลนี้ยังไม่เปิดให้ตอบ</Button>
    } else if (reason === 'NOT_STARTED') {
        actions = <Button disabled className={pill}>เปิดโหวต {formatThaiDateTime(poll.opensAt!)}</Button>
    } else if (reason === 'CLOSED') {
        actions = <><Button disabled className={pill}>{closedEarly ? 'ถูกปิดก่อนกำหนด' : 'ปิดโหวตแล้ว'}</Button>{myAnswers}{results}</>
    } else if (reason === 'NOT_ELIGIBLE') {
        actions = (
            <>
                <Button disabled className={pill}>บัญชีนี้ไม่อยู่ในกลุ่มผู้ตอบ</Button>
                <p className='text-center text-sm text-ink-500'>คุณเห็นโพลนี้เพราะเป็นเจ้าของโพลหรือผู้ดูแลระบบ</p>
                {results}
            </>
        )
    } else if (reason === 'ALREADY_VOTED') {
        actions = <><Button disabled className={pill}>โหวตแล้ว</Button>{myAnswers}{results}</>
    } else if (draft && !onStart) {
        actions = (
            <>
                <Link href={`/${poll.id}/q/${resumePage}`} className={cn(buttonVariants(), pill)}>
                    {poll.submitted ? 'แก้คำตอบต่อ' : 'โหวตต่อ'}
                </Link>
                {myAnswers}{results}
            </>
        )
    } else if (poll.submitted) {
        // แก้คำตอบได้ = แทนที่คำตอบเดิม (ส่งแล้วแก้ไม่ได้ ineligibleReason เป็น ALREADY_VOTED ไปก่อนแล้ว)
        actions = (
            <>
                {startButton('แก้คำตอบ', true)}
                <div className='grid grid-cols-2 gap-2'>
                    <Link href='/explore' className={outlinePill}>ไปที่หน้าโพลที่ตอบได้</Link>
                    {myAnswers}
                </div>
                {results}
            </>
        )
    } else {
        actions = startButton('เริ่มโหวต')
    }

    return (
        <article className='flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm'>
            {poll.coverImageUrl && (
                // รูปปกครอป 16:9 ให้ตรงกับคำแนะนำตอนอัปโหลด · โดเมนรูปมาจาก S3 ที่ตั้งค่าได้ จึงใช้ img ธรรมดา
                // eslint-disable-next-line @next/next/no-img-element
                <img src={poll.coverImageUrl} alt='' className='-mx-2 -mt-2 aspect-video w-[calc(100%+1rem)] max-w-none rounded-lg bg-inner-bg object-cover' />
            )}
            <div className='flex flex-col gap-1'>
                <h1 className='font-heading text-3xl font-bold break-words'>{poll.title}</h1>
                {draft && !onStart && (
                    <p className='flex items-center gap-1 text-sm text-ink-500 italic'>
                        <CheckCircle2 className='size-4 shrink-0' />
                        บันทึกคำตอบล่าสุด: {savedDate.format(new Date(draft.savedAt))} ({savedTime.format(new Date(draft.savedAt))})
                    </p>
                )}
            </div>

            {closedEarly && (
                <div role='status' className='flex gap-2 rounded-xl bg-inner-bg px-3 py-2'>
                    <Ban className='mt-0.5 size-4 shrink-0 text-ink-500' />
                    <div className='flex flex-col'>
                        <span className='font-bold'>เจ้าของโพลปิดรับคำตอบก่อนกำหนด</span>
                        {poll.closeReason && <span className='text-ink-500 break-words'>เหตุผล: {poll.closeReason}</span>}
                    </div>
                </div>
            )}

            {/* ระบุคนส่ง: บอกก่อนเริ่มตอบเสมอ (รวมตอนยังไม่ login) ผู้ตอบจะได้เลือกได้ว่าจะตอบหรือไม่ */}
            {poll.identifySender && (
                <div role='note' className='flex gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2'>
                    <IdCard className='mt-0.5 size-4 shrink-0 text-primary' />
                    <div className='flex flex-col'>
                        <span className='font-bold'>โพลนี้ระบุคนส่ง</span>
                        <span className='text-ink-500'>เจ้าของโพลจะเห็นรหัสนิสิต/บุคลากรของคุณคู่กับคำตอบ</span>
                    </div>
                </div>
            )}

            <dl className='flex flex-col gap-2'>
                <MetaRow label='ขอบเขตผู้ตอบ'><AudienceScopeView label={poll.audienceLabel} scope={poll.audienceScope} /></MetaRow>
                {poll.opensAt && (
                    <MetaRow label='เวลาเปิดโหวต'>{formatThaiDateTime(poll.opensAt)}</MetaRow>
                )}
                <MetaRow label='เวลาปิดโหวต'>
                    {closedEarly && poll.closesAt
                        ? `ปิดจริง ${formatThaiDateTime(poll.closedAt!)} · กำหนดเดิม ${formatThaiDateTime(poll.closesAt)}`
                        : poll.closesAt ? `${formatThaiDateTime(poll.closesAt)} (${formatTimeLeftShort(poll.closesAt)})` : 'ยังไม่ตั้งเวลาปิด'}
                </MetaRow>
                {poll.description && (
                    <MetaRow label='รายละเอียด'>
                        <button
                            type='button'
                            aria-expanded={expanded}
                            onClick={() => setExpanded((v) => !v)}
                            className={cn('rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50', !expanded && 'line-clamp-2')}
                        >
                            {poll.description}
                        </button>
                    </MetaRow>
                )}
            </dl>

            <div className='grid grid-cols-2 border-y py-3'>
                <div className='flex flex-col items-center gap-0.5 border-r'>
                    <span className='text-sm text-ink-500'>จำนวนคำถาม</span>
                    <span className='flex items-center gap-1 font-bold'><List className='size-4' />{poll.questionCount} คำถาม</span>
                </div>
                <div className='flex flex-col items-center gap-0.5'>
                    <span className='text-sm text-ink-500'>ระยะเวลาที่ใช้</span>
                    <span className='flex items-center gap-1 font-bold'><Timer className='size-4' />~{estimateMinutes(poll.questionCount)} นาที</span>
                </div>
            </div>

            <div className='flex flex-col gap-2'>{actions}</div>
        </article>
    )
}
