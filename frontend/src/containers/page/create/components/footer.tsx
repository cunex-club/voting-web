'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Send, Eye, Download, ArrowLeft, ArrowRight, Loader2, Trash2 } from 'lucide-react'
import { api, errorMessage } from '@/api'
import type { CreateStep } from '@/store/createStepStore'
import { SubmitDialog } from './submitDialog'
import { DeleteDraftDialog } from './deleteDraftDialog'
import { resetCreateForm, saveDraft, submitDraft } from '../draftActions'
import { useCreatePollStore } from '@/store/createPollStore'
import { needsReview } from '@/lib/pollLabels'

// draftId = กำลังแก้ฉบับร่างที่บันทึกไว้แล้ว (ลบได้) · บันทึก/ส่งจะเขียนทับฉบับร่างเดิม ไม่สร้างโพลซ้ำ
export function CreateFooter({ step, onStepChange, draftId }: {
    step: CreateStep
    onStepChange: (next: CreateStep) => void
    draftId: string | null
}) {
    const router = useRouter()
    const [submitOpen, setSubmitOpen] = useState(false)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<{ message: string; problems?: string[] } | null>(null)
    const [draftSaving, setDraftSaving] = useState(false)
    const [draftError, setDraftError] = useState<string | null>(null)
    const [deleteOpen, setDeleteOpen] = useState(false)
    // เฉพาะโพลทั้งจุฬาฯ ที่ต้องรออนุมัติ
    const review = useCreatePollStore((s) => needsReview(s.audienceType))

    const handleSubmit = async () => {
        setPending(true)
        setError(null)
        const result = await submitDraft()
        setPending(false)
        if (!result.ok) {
            setError({ message: result.error, problems: result.problems })
            return
        }
        // ส่งสำเร็จแล้วร่างในเครื่องไม่มีประโยชน์ จึงล้างทั้งข้อมูลโพลและคำถาม
        resetCreateForm()
        setSubmitOpen(false)
        toast.success(result.poll.status === 'pending_review' ? 'ส่งขออนุมัติแล้ว' : 'ส่งโพลแล้ว กดเปิดโหวตได้เลย')
        router.push(`/dashboard/${result.poll.id}`)
    }

    // หน้าดูตัวอย่างอ่านจากร่างใน store โดยตรง ไม่ต้องบันทึกก่อน
    const openPreview = () => router.push('/create/preview')

    const handleSaveDraft = async () => {
        setDraftSaving(true)
        setDraftError(null)
        const result = await saveDraft()
        if (!result.ok) {
            setDraftSaving(false)
            setDraftError([result.error, ...(result.problems ?? [])].join('\n'))
            return
        }
        resetCreateForm()
        toast.success('บันทึกฉบับร่างแล้ว')
        router.push('/')
    }

    const handleDelete = async () => {
        if (!draftId) return
        try {
            await api.polls.remove(draftId)
            resetCreateForm()
            setDeleteOpen(false)
            toast.success('ลบฉบับร่างแล้ว')
            router.push('/')
        } catch (err) {
            toast.error(errorMessage(err, 'ลบฉบับร่างไม่สำเร็จ'))
        }
    }

    return (
        <div className='flex flex-col gap-2 py-4 pb-8 items-start relative'>
            {/* ยืดพื้นออกไปชนขอบจอเท่ากับ padding ของหน้า (px-4) ไม่ใช้ w-screen เพราะรวมความกว้าง scrollbar แล้วล้นจอ */}
            <div className='absolute inset-y-0 -inset-x-4 bg-ink-400/5 -z-1'/>
            <div className='flex w-full items-center justify-between gap-2'>
                <button
                    type='button'
                    onClick={handleSaveDraft}
                    disabled={draftSaving}
                    aria-busy={draftSaving}
                    className='text-ink-500 font-heading font-bold flex gap-1 items-center cursor-pointer underline disabled:opacity-50'
                >
                    {draftSaving ? <Loader2 className='size-4 animate-spin'/> : <Download className='size-4'/>}
                    <span>บันทึกฉบับร่าง</span>
                </button>
                {draftId && (
                    <button
                        type='button'
                        onClick={() => setDeleteOpen(true)}
                        className='text-destructive font-heading font-bold flex gap-1 items-center cursor-pointer underline'
                    >
                        <Trash2 className='size-4'/>
                        <span>ลบฉบับร่าง</span>
                    </button>
                )}
            </div>
            {draftError && <p role='alert' className='text-base text-destructive whitespace-pre-line'>{draftError}</p>}
            {step === 1 ? (
                <Button type='button' className={`w-full`} onClick={() => onStepChange(2)}>
                    <span className='font-heading text-lg font-bold'>ถัดไป</span>
                    <ArrowRight/>
                </Button>
            ) : (
                <div className='flex gap-1 w-full'>
                    <Button type='button' variant='outline' className={`px-4`} onClick={() => onStepChange(1)}>
                        <ArrowLeft/>
                        <span className='font-heading text-lg font-bold'>ย้อนกลับ</span>
                    </Button>
                    <Button type='button' className={`grow`} onClick={() => { setError(null); setSubmitOpen(true) }}>
                        <Send/>
                        <span className='font-heading text-lg font-bold'>{review ? 'ส่งขออนุมัติ' : 'ส่งโพล'}</span>
                    </Button>
                    <Button aria-label='ดูตัวอย่าง' className={" aspect-square bg-yellow-500 "} onClick={openPreview}><Eye/></Button>
                    <SubmitDialog
                        open={submitOpen}
                        onOpenChange={setSubmitOpen}
                        onPreview={() => { setSubmitOpen(false); openPreview() }}
                        onSubmit={handleSubmit}
                        pending={pending}
                        error={error}
                        review={review}
                    />
                </div>
            )}
            <DeleteDraftDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={handleDelete} />
        </div>
    )
}
