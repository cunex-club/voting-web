'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Eye } from 'lucide-react'
import { useCreatePollStore } from '@/store/createPollStore'
import { useElementStore } from '@/store/elementStore'
import { useCreateStepStore } from '@/store/createStepStore'
import { useCreateDraftStore } from '@/store/createDraftStore'
import { audienceLabel, audienceScope } from '@/lib/audienceLabel'
import { useFaculties } from '@/hooks/useFaculties'
import { audienceOfForm } from '@/lib/pollMappers'
import { AUDIENCE_DESCRIPTION } from '@/lib/pollLabels'
import { firstMissingRequired, paginate, questionsOf, type Answers, type AnswerValue, type VoteItem, type VoterPoll } from '@/lib/voteForm'
import AvatarPopup from '@/containers/widgets/components/avator-popup'
import { PollIntroCard } from '../components/pollIntroCard'
import { AnonymityNote } from '../components/anonymityNote'
import { PageItems } from '../components/pageItems'
import { QuestionProgress } from '../components/questionProgress'
import { StepActionBar } from '../components/stepActionBar'

// หน้าดูตัวอย่างของผู้สร้าง: อ่านจากร่างที่ยังไม่บันทึกใน store (ร่างที่ยังไม่ได้กดบันทึกก็ดูได้)
// ใช้ component ชุดเดียวกับหน้ากรอกจริง ตอบลองได้แต่ส่งไม่ได้ คำตอบอยู่แค่ในหน้านี้
export function VotePreview() {
    const router = useRouter()
    const form = useCreatePollStore()
    const rawItems = useElementStore((s) => s.items)
    const draftId = useCreateDraftStore((s) => s.hydratedId)
    // -1 = หน้าแรกของโพล, 0.. = หน้าคำถาม
    const [pageIndex, setPageIndex] = useState(-1)
    const [answers, setAnswers] = useState<Answers>({})

    const items: VoteItem[] = rawItems.map((item) => ({ ...item, key: item.id }))
    const pages = paginate(items)
    const questions = questionsOf(items)

    // ร่างยังไม่มีเวลาปิดได้ ใช้อีก 7 วันแทนเพื่อให้หน้าแรกแสดงได้ (คิดครั้งเดียวตอนเปิดหน้า)
    const [fallbackClose] = useState(() => new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString())
    const faculties = useFaculties() ?? []
    const audience = audienceOfForm(form)
    const poll: VoterPoll = {
        id: 'preview',
        title: form.title || 'ยังไม่ได้ตั้งชื่อโพล',
        description: form.desc,
        coverImageUrl: form.coverImageUrl,
        status: 'open',
        // หน้าดูตัวอย่างต้องลองตอบได้เสมอ จึงไม่ใช้เวลาเปิดจริงมาตัดสินสถานะ
        opensAt: null,
        closesAt: form.closeTime ?? fallbackClose,
        closedAt: null,
        closedEarly: false,
        closeReason: null,
        audience,
        // "ระบุรหัส" ส่งเป็นทั้งจุฬาฯ แต่หน้าตัวอย่างให้ผู้สร้างเห็นขอบเขตที่ตั้งไว้
        audienceLabel: form.audienceType === 'codes' ? AUDIENCE_DESCRIPTION.codes : audienceLabel(audience, faculties),
        audienceScope: audienceScope(audience, faculties),
        realtime: form.realtime,
        allowAnswerEdit: form.allowAnswerEdit,
        items,
        questionCount: questions.length,
        resultsPublished: true,
        canViewResults: false,
        submitted: false,
        canEdit: false,
        isOwner: true,
    }

    // กลับไปแก้ต่อที่ขั้นคำถาม (ขั้นที่ 2) ของร่างเดิม ร่างยังอยู่ครบใน store
    const backToEdit = () => {
        useCreateStepStore.getState().setResumeStep(2)
        router.push(draftId ? `/create/${draftId}` : '/create')
    }

    const page = pageIndex >= 0 ? pages[pageIndex] : null
    const pageQuestions = page ? questions.filter((q) => page.some((item) => item.key === q.key)) : []
    const goTo = (index: number) => {
        setPageIndex(index)
        window.scrollTo({ top: 0 })
    }
    const setAnswer = (key: string, value: AnswerValue | undefined) => setAnswers((prev) => {
        const next = { ...prev }
        if (value === undefined) delete next[key]
        else next[key] = value
        return next
    })

    return (
        <>
            <header className='sticky top-0 z-30 -mx-4 flex h-16 items-center justify-between border-b bg-background px-4'>
                <button
                    type='button'
                    onClick={backToEdit}
                    className='flex items-center gap-1 rounded-sm font-bold text-primary underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
                >
                    <ArrowLeft className='size-4' />
                    กลับไปแก้ไข
                </button>
                <AvatarPopup />
            </header>
            <p role='status' className='-mx-4 mb-4 flex items-center justify-center gap-2 bg-yellow-100 px-4 py-2 text-sm text-yellow-700'>
                <Eye className='size-4 shrink-0' />
                นี่คือตัวอย่าง ลองตอบได้แต่ส่งคำตอบไม่ได้
            </p>

            {page === null ? (
                <>
                    <PollIntroCard poll={poll} reason={null} onStart={() => goTo(0)} />
                    <AnonymityNote className='mt-4' />
                </>
            ) : (
                <div className='flex flex-1 flex-col'>
                    <QuestionProgress page={pageIndex + 1} total={pages.length} />
                    {page.length === 0
                        ? <p className='pt-6 text-ink-500'>ร่างนี้ยังไม่มีคำถาม</p>
                        : <PageItems page={page} questions={questions} answers={answers} onAnswer={setAnswer} />}
                    <div className='flex-1' />
                    <StepActionBar
                        isFirst={pageIndex === 0}
                        isLast={pageIndex === pages.length - 1}
                        canNext={firstMissingRequired(pageQuestions, answers) === null}
                        busy={false}
                        onBack={() => goTo(pageIndex - 1)}
                        onNext={() => goTo(pageIndex + 1)}
                        onSubmit={() => {}}
                        preview
                    />
                </div>
            )}
        </>
    )
}
