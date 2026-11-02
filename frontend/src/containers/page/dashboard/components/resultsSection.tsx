'use client'
import React, { useState } from 'react'
import type { ResultsModel } from '@/lib/pollResultTypes'
import type { ResultView } from '@/lib/resultView'
import { ViewToggleBar } from './viewToggleBar'
import { QuestionCard } from './questionCard'

// ส่วนผลโหวตในหน้ารายละเอียด: สรุปผลทุกข้อ มุมมองที่เลือกใช้กับทุกข้อพร้อมกัน (ข้อความไม่สนมุมมอง)
// คำตอบรายคนและไฟล์ส่งออกมีเฉพาะโพลที่ระบุคนส่ง (RespondentsSection) โพลอื่นโยงคำตอบของคนเดียวกันไม่ได้
export function ResultsSection({ results }: { results: ResultsModel }) {
    const [views, setViews] = useState<ResultView[]>(['list'])
    return (
        <section aria-labelledby='results-heading' className='flex flex-col gap-4'>
            <h2 id='results-heading' className='font-heading text-xl font-bold'>ผลโหวต</h2>
            <ViewToggleBar views={views} onChange={setViews} total={results.totalRespondents ?? 0} />
            {results.questions.length === 0 && <p className='text-ink-500'>โพลนี้ยังไม่มีคำถาม</p>}
            {results.questions.map((q) => (
                <QuestionCard key={q.elementId} pollId={results.pollId} question={q} numbers={results.numbers} views={views} />
            ))}
        </section>
    )
}
