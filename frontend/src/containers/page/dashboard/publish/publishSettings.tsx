'use client'
import React, { useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api, errorMessage } from '@/api'
import type { Element, ResultDisplay } from '@/api/types'
import { toResultsModel, type ResultsModel } from '@/lib/pollResultTypes'
import { applyDisplay } from '@/lib/resultDisplay'
import { useLiveResults } from '@/hooks/useLiveResults'
import { ViewToggleBar } from '@/containers/page/dashboard/components/viewToggleBar'
import { VoterResultsView } from '@/containers/page/vote/voterResults'

const NUMBER_OPTIONS: { key: 'showCount' | 'showPercent' | 'showTotal'; label: string; hint: string }[] = [
    { key: 'showCount', label: 'จำนวนคนต่อตัวเลือก', hint: 'เช่น 70 คน' },
    { key: 'showPercent', label: 'ร้อยละต่อตัวเลือก', hint: 'เช่น 36.8%' },
    { key: 'showTotal', label: 'จำนวนผู้ตอบรวม', hint: 'เช่น ตอบแล้ว 190 คน' },
]

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
    return (
        <section className='flex flex-col gap-3 rounded-2xl border bg-card p-4'>
            <div className='flex flex-col'>
                <h2 className='font-heading text-lg font-bold'>{title}</h2>
                {description && <p className='text-sm text-ink-500'>{description}</p>}
            </div>
            {children}
        </section>
    )
}

// ฟอร์มตั้งค่า + ตัวอย่างสดของสิ่งที่ผู้ตอบจะเห็น (จำลองการกรองแบบเดียวกับที่ backend ทำก่อนส่งผลให้ผู้ตอบ)
export function PublishSettings({ pollId, realtime, elements, initialSettings, initialResults }: {
    pollId: string
    realtime: boolean
    elements: Element[]
    initialSettings: ResultDisplay
    initialResults: ResultsModel
}) {
    const poll = { id: pollId, status: initialResults.status, elements }
    const results = useLiveResults(initialResults, initialResults.status === 'open', async (signal) =>
        toResultsModel(poll, await api.polls.results(pollId, 'none', signal)))
    const [saved, setSaved] = useState(initialSettings)
    const [settings, setSettings] = useState(initialSettings)
    const [saving, setSaving] = useState(false)
    const dirty = JSON.stringify(settings) !== JSON.stringify(saved)

    const choices = results.questions.filter((q) => q.type !== 'text_question')
    const selected = settings.elementIds ?? choices.map((q) => q.elementId)
    const update = (patch: Partial<ResultDisplay>) => setSettings((s) => ({ ...s, ...patch }))

    const toggleQuestion = (elementId: string, on: boolean) => {
        const next = on ? [...selected, elementId] : selected.filter((id) => id !== elementId)
        // เลือกครบทุกข้อเก็บเป็น null = ทุกข้อ
        const all = choices.every((q) => next.includes(q.elementId))
        update({ elementIds: all ? null : choices.map((q) => q.elementId).filter((id) => next.includes(id)) })
    }

    const save = async () => {
        if (settings.published && selected.length === 0) {
            toast.error('เลือกอย่างน้อยหนึ่งข้อที่จะเผยแพร่ หรือปิดการเผยแพร่')
            return
        }
        setSaving(true)
        try {
            const { resultDisplay } = await api.polls.setResultDisplay(pollId, settings)
            setSaved(resultDisplay)
            setSettings(resultDisplay)
            toast.success('บันทึกการตั้งค่าแล้ว')
        } catch (err) {
            toast.error(errorMessage(err, 'บันทึกไม่สำเร็จ'))
        } finally {
            setSaving(false)
        }
    }

    const preview = applyDisplay(results, settings)

    return (
        <div className='flex flex-col gap-4 pb-4'>
            <Section
                title='เผยแพร่ผลให้ผู้ตอบ'
                description={realtime
                    ? 'โพลนี้เปิด realtime ผู้ตอบที่ส่งแล้วกด "ดูผลโหวต" ในหน้ารวมโพลได้ทันที'
                    : 'โพลนี้ไม่ได้เปิด realtime ผู้ตอบจะเห็นผลหลังปิดโหวต'}
            >
                <div className='flex items-center gap-2'>
                    <Switch id='publish' checked={settings.published} onCheckedChange={(v) => update({ published: v })} />
                    <Label htmlFor='publish' className='font-heading text-base font-bold'>
                        {settings.published ? 'เผยแพร่อยู่' : 'ไม่เผยแพร่ (ผู้ตอบไม่เห็นผล)'}
                    </Label>
                </div>
            </Section>

            {/* ตั้งรายละเอียดได้ตลอดแม้ปิดเผยแพร่อยู่ เตรียมไว้ก่อนเปิดได้ แต่จางลงให้รู้ว่ายังไม่มีผล */}
            <fieldset disabled={!settings.published} className='flex flex-col gap-4 transition-opacity disabled:opacity-50'>
                <Section title='ข้อที่จะโชว์' description='เฉพาะคำถามแบบเลือก คำตอบแบบข้อความไม่เผยแพร่ให้ผู้ตอบ'>
                    {choices.length === 0 && <p className='text-ink-500'>โพลนี้ไม่มีคำถามแบบเลือก</p>}
                    {choices.map((q) => (
                        <label key={q.elementId} className='flex items-start gap-2'>
                            <Checkbox
                                className='mt-1 size-5'
                                checked={selected.includes(q.elementId)}
                                onCheckedChange={(on) => toggleQuestion(q.elementId, on)}
                            />
                            <span className='min-w-0 break-words'>ข้อ {q.order} {q.title}</span>
                        </label>
                    ))}
                </Section>

                <Section title='รูปแบบกราฟ' description='เลือกได้หลายแบบ ผู้ตอบจะเห็นเรียงลงมา รายการ → โดนัท → แท่ง'>
                    <ViewToggleBar views={settings.views} onChange={(views) => update({ views })} compare={false} />
                </Section>

                <Section title='ตัวเลขที่เปิดเผย' description='ปิดทุกตัวเลขก็ยังเห็นสัดส่วนจากความยาวของกราฟ'>
                    {NUMBER_OPTIONS.map((o) => (
                        <div key={o.key} className='flex items-center gap-2'>
                            <Switch id={o.key} checked={settings[o.key]} onCheckedChange={(v) => update({ [o.key]: v })} />
                            <Label htmlFor={o.key} className='text-base'>
                                <span className='font-bold'>{o.label}</span>
                                <span className='text-sm text-ink-500'>{o.hint}</span>
                            </Label>
                        </div>
                    ))}
                </Section>
            </fieldset>

            <section aria-label='ตัวอย่างที่ผู้ตอบเห็น' className='flex flex-col gap-2'>
                <h2 className='font-heading text-lg font-bold'>ตัวอย่างที่ผู้ตอบเห็น</h2>
                {settings.published ? (
                    <VoterResultsView results={preview} views={settings.views} live={realtime && results.status === 'open'} className='rounded-2xl bg-inner-bg p-4' />
                ) : (
                    <p className='rounded-2xl bg-inner-bg px-4 py-6 text-center text-ink-500'>ผู้ตอบจะไม่เห็นผลโหวตของโพลนี้</p>
                )}
            </section>

            <div data-bottom-bar className='sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t bg-background px-4 py-3'>
                {dirty && <span className='text-sm text-ink-500'>มีการเปลี่ยนแปลงที่ยังไม่บันทึก</span>}
                <Button className='rounded-full px-6 font-heading text-base font-bold' disabled={!dirty || saving} aria-busy={saving} onClick={save}>
                    {saving ? <Loader2 className='animate-spin' /> : <Save />}
                    บันทึก
                </Button>
            </div>
        </div>
    )
}
