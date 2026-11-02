'use client'
import React, { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { api, downloadUrls, errorMessage } from '@/api'
import { isQuestion, type Element, type Respondent } from '@/api/types'
import { Button, buttonVariants } from '@/components/ui/button'
import { formatThaiDateTime } from '@/lib/thaiDate'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50

// ระบุคนส่ง: ตารางผู้ตอบรายคน (รหัส · เวลาที่ส่ง · คำตอบทุกข้อ) เฉพาะเจ้าของ/แอดมิน
// ตารางโหลดทีละหน้า ไฟล์ CSV ได้ครบทุกคนในครั้งเดียวจาก backend
export function RespondentsSection({ pollId, elements, total }: {
    pollId: string
    elements: Element[]
    total: number
}) {
    const questions = elements.filter(isQuestion)
    const labels = new Map(questions.flatMap((q) => ('options' in q ? q.options : []).map((o) => [o.id, o.label] as const)))
    const [rows, setRows] = useState<Respondent[]>([])
    const [cursor, setCursor] = useState<string | null | undefined>(undefined)
    const [loading, setLoading] = useState(total > 0)
    const [error, setError] = useState<string | null>(null)

    const load = async (after: string | null) => {
        setLoading(true)
        setError(null)
        try {
            const page = await api.polls.responses(pollId, after, PAGE_SIZE)
            setRows((prev) => (after ? [...prev, ...page.items] : page.items))
            setCursor(page.nextCursor)
        } catch (err) {
            setError(errorMessage(err, 'โหลดรายชื่อผู้ตอบไม่สำเร็จ ลองใหม่อีกครั้ง'))
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (total === 0) return
        let alive = true
        api.polls.responses(pollId, null, PAGE_SIZE)
            .then((page) => { if (alive) { setRows(page.items); setCursor(page.nextCursor) } })
            .catch((err) => { if (alive) setError(errorMessage(err, 'โหลดรายชื่อผู้ตอบไม่สำเร็จ ลองใหม่อีกครั้ง')) })
            .finally(() => { if (alive) setLoading(false) })
        return () => { alive = false }
    }, [pollId, total])

    const cell = (r: Respondent, elementId: string | undefined) => {
        const a = r.answers.find((x) => x.elementId === elementId)
        if (!a) return <span className='text-ink-400'>-</span>
        return 'text' in a ? a.text : a.optionIds.map((id) => labels.get(id) ?? '').join(', ')
    }

    return (
        <section aria-labelledby='respondents-heading' className='flex flex-col gap-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
                <div className='flex flex-col'>
                    <h2 id='respondents-heading' className='font-heading text-xl font-bold'>ผู้ตอบรายคน</h2>
                    <p className='text-sm text-ink-500'>โพลนี้ระบุคนส่ง ผู้ตอบได้รับแจ้งก่อนเริ่มตอบแล้ว</p>
                </div>
                {total > 0 && (
                    <a href={downloadUrls.responsesCsv(pollId)} download className={cn(buttonVariants({ variant: 'outline' }), 'rounded-full border-primary font-heading font-bold text-primary')}>
                        <Download />
                        ดาวน์โหลด CSV
                    </a>
                )}
            </div>

            {total === 0 ? (
                <p className='text-ink-500'>ยังไม่มีผู้ตอบ</p>
            ) : (
                <div className='overflow-x-auto rounded-2xl border'>
                    <table className='w-full min-w-max text-left text-sm'>
                        <thead className='bg-inner-bg'>
                            <tr>
                                <th scope='col' className='px-3 py-2 font-bold'>รหัส</th>
                                <th scope='col' className='px-3 py-2 font-bold'>เวลาที่ส่ง</th>
                                {questions.map((q, i) => (
                                    <th key={q.id} scope='col' className='max-w-60 px-3 py-2 font-bold'>{q.title || `ข้อ ${i + 1}`}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => (
                                <tr key={`${r.code}-${i}`} className='border-t align-top'>
                                    <td className='px-3 py-2 font-mono'>{r.code ?? <span className='text-ink-400'>ไม่มีรหัส</span>}</td>
                                    <td className='px-3 py-2 whitespace-nowrap'>{formatThaiDateTime(r.submittedAt)}</td>
                                    {questions.map((q) => (
                                        <td key={q.id} className='max-w-60 px-3 py-2 break-words whitespace-pre-line'>{cell(r, q.id)}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {error && <p role='alert' className='text-destructive'>{error}</p>}
            {loading && <Loader2 className='mx-auto animate-spin text-ink-500' aria-label='กำลังโหลด' />}
            {!loading && cursor && (
                <Button variant='outline' className='self-center rounded-full font-heading text-base font-bold' onClick={() => load(cursor)}>
                    โหลดเพิ่ม
                </Button>
            )}
            {!loading && error && rows.length === 0 && (
                <Button variant='outline' className='self-center rounded-full font-heading text-base font-bold' onClick={() => load(null)}>
                    ลองใหม่
                </Button>
            )}
        </section>
    )
}
