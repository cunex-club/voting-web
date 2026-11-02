import React from 'react'
import type { Faculty, PollDetail } from '@/api/types'
import { formatThaiDateTime, formatTimeLeftShort } from '@/lib/thaiDate'
import { audienceLabel, audienceScope } from '@/lib/audienceLabel'
import { AudienceScopeView } from '@/components/common/audienceScopeView'
import { RealtimeSwitch } from './realtimeSwitch'
import { ClosesAtEditor } from './closesAtEditor'

// รายละเอียดโพลแบบ label/value เรียงลงล่าง · ส่วนที่แก้ได้ (เวลาปิด/เรียลไทม์) โชว์ปุ่มเฉพาะเจ้าของ
export function PollMetaInfo({ poll, faculties }: { poll: PollDetail; faculties: Faculty[] }) {
    const owner = poll.isOwner
    // โพลที่ปิดก่อนกำหนดโชว์เวลาปิดจริงคู่กับกำหนดเดิม
    const closeText = !poll.closesAt
        ? 'ยังไม่ตั้งเวลาปิด'
        : poll.closedEarly && poll.closedAt
            ? `ปิดจริง ${formatThaiDateTime(poll.closedAt)} · กำหนดเดิม ${formatThaiDateTime(poll.closesAt)}`
            : `${formatThaiDateTime(poll.closesAt)} (${formatTimeLeftShort(poll.closesAt)})`
    const canMoveClose = owner && ['pending_review', 'approved', 'open'].includes(poll.status)

    const rows: { label: string; value: React.ReactNode }[] = [
        { label: 'ขอบเขตผู้ตอบ', value: <AudienceScopeView label={audienceLabel(poll.audience, faculties)} scope={audienceScope(poll.audience, faculties)} /> },
        ...(poll.opensAt ? [{ label: 'เวลาเปิดโหวต', value: formatThaiDateTime(poll.opensAt) }] : []),
        {
            label: 'เวลาปิดโหวต',
            value: <span className='flex flex-col gap-1'>{closeText}{canMoveClose && <ClosesAtEditor pollId={poll.id} closesAt={poll.closesAt} />}</span>,
        },
    ]
    if (poll.closedEarly && poll.closeReason) rows.push({ label: 'เหตุผลที่ปิดก่อนกำหนด', value: poll.closeReason })
    if (poll.takenDown) rows.push({ label: 'ถูกถอดโดยผู้ดูแลระบบ', value: poll.takedownReason ?? '-' })
    rows.push({
        label: 'การลงคะแนน',
        value: poll.settings.allowAnswerEdit ? 'หนึ่งคนหนึ่งเสียง · แก้คำตอบได้จนกว่าจะปิดโหวต' : 'หนึ่งคนหนึ่งเสียง · ส่งแล้วแก้ไม่ได้',
    })
    rows.push({
        label: 'แสดงผลแบบเรียลไทม์',
        value: owner && (poll.status === 'pending_review' || poll.status === 'approved')
            ? <RealtimeSwitch pollId={poll.id} realtime={poll.settings.showResultsRealtime} />
            : poll.settings.showResultsRealtime ? 'เปิด' : 'ปิด',
    })
    rows.push({ label: 'หน้ารวมโพล', value: poll.settings.listedPublicly ? 'แสดง' : 'ไม่แสดง (เข้าได้ทางลิงก์เท่านั้น)' })
    rows.push({ label: 'ระบุคนส่ง', value: poll.settings.identifySender ? 'เปิด · เห็นรหัสผู้ตอบคู่กับคำตอบ' : 'ปิด · ไม่ระบุตัวผู้ตอบ' })

    return (
        <dl className='flex flex-col gap-2'>
            {rows.map((row) => (
                <div key={row.label}>
                    <dt className='text-sm text-ink-500'>{row.label}</dt>
                    <dd className='pl-2 text-base'>{row.value}</dd>
                </div>
            ))}
        </dl>
    )
}
