'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { api, errorMessage, isApiError } from '@/api'
import { firstMissingRequired, fromBallot, paginate, questionsOf, toApiAnswers, type VoterPoll } from '@/lib/voteForm'
import { clearDraft, readDraft } from '@/lib/voteDraft'
import { saveVoteDraft, useSaveDraft } from '@/hooks/useVoteFlow'
import { isVoteDirty, useVoteFlowStore } from '@/store/voteFlowStore'
import { PageItems } from './components/pageItems'
import { QuestionProgress } from './components/questionProgress'
import { StepActionBar } from './components/stepActionBar'
import { ConfirmSubmitModal } from './components/confirmSubmitModal'

// หน้าคำถามหนึ่งหน้า (ตัดหน้าด้วย page_break) เปลี่ยนหน้า = บันทึกฉบับร่างในเบราว์เซอร์ก่อนเสมอ
// เข้าได้เฉพาะตอนมีฉบับร่าง (กดเริ่มโหวต/แก้คำตอบที่หน้าแรกแล้ว) ไม่งั้นพากลับหน้าแรกของโพล
export function VoteStep({ poll, pageIndex }: { poll: VoterPoll; pageIndex: number }) {
    const router = useRouter()
    const pages = paginate(poll.items)
    const page = pages[pageIndex]
    const isFirst = pageIndex === 0
    const isLast = pageIndex === pages.length - 1
    const questions = questionsOf(poll.items)

    const storePollId = useVoteFlowStore((s) => s.pollId)
    const answers = useVoteFlowStore((s) => s.answers)
    const setAnswer = useVoteFlowStore((s) => s.setAnswer)
    const { saving, save } = useSaveDraft(poll.id)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    // ระหว่างเปลี่ยนหน้าในโพลเดิม คำตอบในหน่วยความจำคือของล่าสุด อ่านฉบับร่างเฉพาะตอนเพิ่งเข้าโพลนี้
    const ready = storePollId === poll.id
    useEffect(() => {
        if (useVoteFlowStore.getState().pollId === poll.id) return
        const draft = readDraft(poll.id)
        if (!draft) {
            router.replace(`/${poll.id}`)
            return
        }
        const questions = questionsOf(poll.items)
        const textKeys = questions.filter((q) => q.type === 'text').map((q) => q.key)
        useVoteFlowStore.getState().init(poll.id, fromBallot(questions, draft), draft.savedAt, textKeys)
    }, [poll.id, poll.items, router])

    // ปิดแท็บ/รีเฟรชตอนยังไม่ได้บันทึกให้เบราว์เซอร์ถามก่อน
    // ออกจากหน้าด้วยปุ่มย้อนกลับของเบราว์เซอร์ให้บันทึกเงียบๆ แทนการถาม (ไม่ต้องดักประวัติการท่องเว็บ)
    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isVoteDirty()) e.preventDefault()
        }
        const onPopState = () => {
            if (isVoteDirty()) void saveVoteDraft(poll.id)
        }
        window.addEventListener('beforeunload', onBeforeUnload)
        window.addEventListener('popstate', onPopState)
        return () => {
            window.removeEventListener('beforeunload', onBeforeUnload)
            window.removeEventListener('popstate', onPopState)
        }
    }, [poll.id])

    const current = ready ? answers : {}
    const pageQuestions = questions.filter((q) => page.some((item) => item.key === q.key))
    const pageMissing = firstMissingRequired(pageQuestions, current)

    const goTo = async (index: number) => {
        if (isVoteDirty()) {
            const result = await save()
            if (!result.ok) {
                toast.error(result.error)
                return
            }
        }
        router.push(`/${poll.id}/q/${index + 1}`)
        window.scrollTo({ top: 0 })
    }

    const openConfirm = () => {
        // ตรวจข้อบังคับทั้งฟอร์มก่อนเปิด dialog ข้อที่ขาดอยู่หน้าอื่นให้พาไปหน้านั้นเลย
        const missing = firstMissingRequired(questions, current)
        if (missing) {
            toast.error(`ยังไม่ได้ตอบข้อ ${missing.order} ซึ่งต้องตอบ`)
            const index = pages.findIndex((p) => p.some((item) => item.key === missing.key))
            if (index !== pageIndex) void goTo(index)
            return
        }
        setConfirmOpen(true)
    }

    const submit = async () => {
        setSubmitting(true)
        try {
            const body = toApiAnswers(questions, current)
            // upsert คำตอบเดียวของตัวเอง ส่งซ้ำ = แทนที่ของเดิม (ถ้าโพลให้แก้คำตอบ)
            await api.ballot.put(poll.id, { answers: body })
            clearDraft(poll.id)
            useVoteFlowStore.getState().reset()
            // replace ไม่ให้ปุ่มย้อนกลับพากลับมาหน้าคำถามที่ส่งไปแล้ว
            // โพลเปิด realtime และเผยแพร่ผล ไปหน้าผลทันที ไม่งั้นขึ้นหน้าขอบคุณ
            router.replace(poll.realtime && poll.resultsPublished ? `/${poll.id}/results?submitted=1` : `/${poll.id}/done`)
            router.refresh()
        } catch (err) {
            if (isApiError(err, 'POLL_CLOSED') || isApiError(err, 'ALREADY_VOTED') || isApiError(err, 'NOT_ELIGIBLE')) {
                toast.error(errorMessage(err))
                router.replace(`/${poll.id}`)
                router.refresh()
                return
            }
            // INVALID_ANSWERS บอกปัญหาข้อแรกให้แก้ (ปกติหน้าเว็บตรวจข้อบังคับไว้ก่อนแล้ว)
            const first = isApiError(err, 'INVALID_ANSWERS') ? err.problem.problems?.[0]?.message : null
            toast.error(first ?? errorMessage(err, 'ส่งคำตอบไม่สำเร็จ คำตอบยังอยู่ ลองส่งใหม่อีกครั้ง'))
            setConfirmOpen(false)
        } finally {
            setSubmitting(false)
        }
    }

    // ยังไม่ได้อ่านฉบับร่าง (หรือกำลังพากลับหน้าแรก)
    if (!ready) return null

    return (
        <div className='flex flex-1 flex-col'>
            <QuestionProgress page={pageIndex + 1} total={pages.length} />
            {poll.submitted && (
                <p role='status' className='mt-4 rounded-xl bg-inner-bg px-4 py-3 text-sm text-ink-500'>
                    กำลังแก้คำตอบที่ส่งไปแล้ว ส่งใหม่แล้วคำตอบเดิมจะถูกแทนที่
                </p>
            )}
            <PageItems page={page} questions={questions} answers={current} onAnswer={setAnswer} />
            <div className='flex-1' />
            <StepActionBar
                isFirst={isFirst}
                isLast={isLast}
                canNext={pageMissing === null}
                busy={saving || submitting}
                onBack={() => goTo(pageIndex - 1)}
                onNext={() => goTo(pageIndex + 1)}
                onSubmit={openConfirm}
            />
            <ConfirmSubmitModal
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                pollTitle={poll.title}
                editing={poll.submitted}
                identified={poll.identifySender}
                pending={submitting}
                onConfirm={submit}
            />
        </div>
    )
}
