import React from 'react'
import { redirect } from 'next/navigation'
import { getFaculties, getMe, getServerApi, loadOrNotFound } from '@/api/server'
import type { PollDetail, PollResults } from '@/api/types'
import { toResultsModel } from '@/lib/pollResultTypes'
import { isBeforeOpening } from '@/lib/voteForm'
import { formatThaiDateTime } from '@/lib/thaiDate'
import { ReviewFooter } from '@/containers/page/dashboard/components/reviewFooter'
import { PollStatusTags } from '@/containers/page/dashboard/components/pollStatusTags'
import { PollMetaInfo } from '@/containers/page/dashboard/components/pollMetaInfo'
import { PollActions } from '@/containers/page/dashboard/components/pollActions'
import { ResultsSection } from '@/containers/page/dashboard/components/resultsSection'
import { RespondentsSection } from '@/containers/page/dashboard/components/respondentsSection'
import { QuestionPreview } from '@/containers/page/dashboard/components/questionPreview'
import { PublishAction } from '@/containers/page/dashboard/components/publishAction'
import { TakedownAction } from '@/containers/page/dashboard/components/takedownAction'

const NOT_OPENED_MESSAGE: Partial<Record<PollDetail['status'], string>> = {
    draft: 'โพลนี้ยังเป็นฉบับร่าง',
    pending_review: 'โพลนี้รออนุมัติอยู่ จะเปิดโหวตได้หลังอนุมัติ',
    rejected: 'โพลนี้ไม่ผ่านการอนุมัติ เจ้าของแก้แล้วส่งใหม่ได้',
}

// เลยเวลาปิดแล้วหรือยัง ณ ตอนที่ server render (หน้านี้ดึงข้อมูลใหม่ทุก request)
const isPastClose = (closesAt: string | null) => !closesAt || new Date(closesAt).getTime() <= Date.now()

// หน้ารายละเอียดโพล slug = id ของโพล
// view = 'owner' (/dashboard) สำหรับเจ้าของ · 'admin' (/admin/(slug)) เพิ่มปุ่มอนุมัติ/ปฏิเสธ/ถอดโพล
// ผลโหวตแสดงเฉพาะโพลที่เปิดโหวตแล้ว (open/closed) สถานะอื่นแสดงคำถามแบบอ่านอย่างเดียวแทน
export async function PollDashboardPage({ slug, view = 'owner' }: { slug: string; view?: 'owner' | 'admin' }) {
    const base = view === 'admin' ? '/admin' : '/dashboard'
    const me = await getMe()
    if (!me) redirect(`/login?returnTo=${encodeURIComponent(`${base}/${slug}`)}`)
    const admin = me.role === 'admin'
    // ยังไม่มี proxy กันหน้าแอดมิน จึงตรวจที่นี่ด้วย คนที่ไม่ใช่แอดมินไปหน้าเจ้าของแทน
    if (view === 'admin' && !admin) redirect(`/dashboard/${slug}`)

    const api = await getServerApi()
    const [poll, faculties] = await loadOrNotFound(() => Promise.all([api.polls.get(slug), getFaculties()]), `${base}/${slug}`)
    // ผู้ตอบทั่วไปเปิดลิงก์ dashboard ได้เพราะโพลเปิดอยู่ ให้ไปหน้ากรอกแทน · แอดมินที่ไม่ใช่เจ้าของใช้หน้าแอดมิน
    if (view === 'owner' && !poll.isOwner) redirect(admin ? `/admin/${slug}` : `/${slug}`)
    // ฉบับร่าง/ถูกปฏิเสธของตัวเองแก้ในหน้าสร้างโพล
    if (view === 'owner' && (poll.status === 'draft' || poll.status === 'rejected')) redirect(`/create/${slug}`)

    const opened = poll.status === 'open' || poll.status === 'closed'
    const results: PollResults | null = opened ? await api.polls.results(slug) : null

    return (
        <div className='mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col gap-6 pb-8'>
            <header className='flex flex-col gap-3'>
                <PollStatusTags status={poll.status} audience={poll.audience.type} realtime={poll.settings.showResultsRealtime} />
                <h1 className='font-heading text-3xl font-bold break-words'>{poll.title || 'ยังไม่ได้ตั้งชื่อโพล'}</h1>
                {view === 'admin' && <p className='text-sm text-ink-500'>มุมมองผู้ดูแลระบบ{poll.isOwner ? ' · โพลของคุณเอง' : ''}</p>}
            </header>

            <PollMetaInfo poll={poll} faculties={faculties} />

            {poll.reviews && poll.reviews.length > 0 && (
                <section aria-label='ประวัติการพิจารณา' className='flex flex-col gap-2 rounded-2xl border p-4'>
                    <h2 className='font-heading text-lg font-bold'>ประวัติการพิจารณา</h2>
                    <ul className='flex flex-col gap-2'>
                        {poll.reviews.map((r) => (
                            <li key={r.createdAt} className='flex flex-col'>
                                <span className='font-bold'>{r.decision === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ'} · <span className='font-normal text-ink-500'>{formatThaiDateTime(r.createdAt)}</span></span>
                                {r.comment && <span className='break-words text-ink-500'>{r.comment}</span>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {opened && results ? (
                <>
                    <div className='flex flex-col gap-2'>
                        <PollActions pollId={poll.id} shareUrl={poll.shareUrl} voting={poll.status === 'open'} owner={poll.isOwner} />
                        {view === 'admin' && <div className='flex justify-end'><TakedownAction pollId={poll.id} /></div>}
                    </div>
                    {/* กดเปิดแบบตั้งเวลาไว้: ขึ้นรายการแล้วแต่ยังไม่รับคำตอบ ไม่บอกไว้จะดูเหมือนเปิดแล้วไม่มีคนตอบ */}
                    {isBeforeOpening(poll) && (
                        <p className='rounded-2xl bg-inner-bg px-4 py-6 text-center text-ink-500'>
                            ยังไม่เริ่มรับคำตอบ จะเปิดให้ตอบ {formatThaiDateTime(poll.opensAt!)}
                        </p>
                    )}
                    <ResultsSection results={toResultsModel(poll, results)} />
                    {poll.settings.identifySender && (
                        <RespondentsSection pollId={poll.id} elements={poll.elements} total={results.totalBallots ?? 0} />
                    )}
                </>
            ) : (
                <>
                    {poll.status === 'approved' ? (
                        <PublishAction pollId={poll.id} opensAt={poll.opensAt} closesAt={poll.closesAt} expired={isPastClose(poll.closesAt)} owner={poll.isOwner} />
                    ) : (
                        <p className='rounded-2xl bg-inner-bg px-4 py-6 text-center text-ink-500'>
                            {NOT_OPENED_MESSAGE[poll.status] ?? 'โพลนี้ยังไม่เปิดโหวต จึงยังไม่มีผลให้ดู'}
                        </p>
                    )}
                    {/* ยังไม่มีผลโหวต แต่ดูได้ว่าโพลถามอะไร */}
                    <QuestionPreview elements={poll.elements} />
                </>
            )}

            {view === 'admin' && poll.status === 'pending_review' && <ReviewFooter pollId={poll.id} />}
        </div>
    )
}
