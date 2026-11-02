import React from 'react'
import { getFaculties, getMe, getServerApi, loadOrNotFound } from '@/api/server'
import { ineligibleReason, previewToVoterPoll } from '@/lib/voteForm'
import { loadVoterPoll } from './loadVoter'
import { VoterHeader } from './components/voterHeader'
import { AnonymityNote } from './components/anonymityNote'
import { PollIntroCard } from './components/pollIntroCard'

// หน้าแรกของโพล /(slug) — ลิงก์/QR ที่แชร์ชี้มาที่นี่
// ยังไม่ login: เห็นรายละเอียดบนการ์ด (ไม่มีคำถาม) พร้อมปุ่มเข้าสู่ระบบเพื่อโหวต
// login แล้ว: โพลที่ไม่มีหรือผู้ใช้อยู่นอกกลุ่มผู้ตอบ API ตอบ 404 จึงไปหน้า not found (ไม่บอกว่าโพลมีอยู่จริงไหม)
export async function VoteIntroPage({ slug }: { slug: string }) {
    if (!(await getMe())) {
        const api = await getServerApi()
        const [preview, faculties] = await loadOrNotFound(() => Promise.all([api.polls.preview(slug), getFaculties()]), `/${slug}`)
        return (
            <>
                <VoterHeader />
                <PollIntroCard poll={previewToVoterPoll(preview, faculties)} reason='LOGIN_REQUIRED' />
                <AnonymityNote className='mt-4' identified={preview.identifySender} />
            </>
        )
    }

    const { me, poll } = await loadVoterPoll(slug, `/${slug}`)
    return (
        <>
            <VoterHeader link={{ href: '/explore', label: 'ไปที่หน้าโพลที่ตอบได้' }} />
            <PollIntroCard poll={poll} reason={ineligibleReason(poll, me)} />
            <AnonymityNote className='mt-4' identified={poll.identifySender} />
        </>
    )
}
