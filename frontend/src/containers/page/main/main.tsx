import React from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PollStatus, PollSummary } from '@/api/types'
import { getServerApi, loadOrNotFound } from '@/api/server'
import { PollSearch } from '@/components/common/search'
import { PollGrid, type PollGridEmpty } from '@/containers/page/main/components/pollGrid'
import { MainTabs } from '@/containers/widgets/tabs'
import { pollHref } from '@/lib/pollHref'

// แต่ละแท็บดึงโพลตามสถานะ: พร้อมใช้งาน = อนุมัติแล้วหรือกำลังโหวต, จบโหวต = ปิดแล้ว, อื่นๆ = ฉบับร่าง/รออนุมัติ/ไม่อนุมัติ
const TAB_STATUSES: Record<string, PollStatus[]> = {
    ready: ['approved', 'open'],
    close: ['closed'],
    else: ['draft', 'pending_review', 'rejected'],
}

const TAB_EMPTY: Record<string, PollGridEmpty> = {
    ready: {
        title: 'ยังไม่มีโพลที่พร้อมใช้งาน',
        description: 'โพลที่อนุมัติแล้วหรือกำลังเปิดโหวตจะอยู่ตรงนี้ เริ่มจากสร้างโพลแรกได้เลย',
        action: (
            <Link href='/create' className={cn(buttonVariants(), 'px-4 py-5 font-heading text-base font-bold')}>
                <Plus />
                สร้างโพล
            </Link>
        ),
    },
    close: {
        title: 'ยังไม่มีโพลที่จบโหวต',
        description: 'เมื่อโพลถึงเวลาปิดหรือถูกปิดรับคำตอบ ผลโหวตจะเก็บไว้ที่นี่',
    },
    else: {
        title: 'ไม่มีฉบับร่างหรือโพลที่รออนุมัติ',
        description: 'ฉบับร่าง โพลที่ส่งขออนุมัติ และโพลที่ไม่ผ่านการอนุมัติ (แก้แล้วส่งใหม่ได้) จะแสดงที่นี่',
    },
}

// โพลของฉันทุกหน้า (GET /me/polls เป็น cursor) · หน้านี้แบ่งตามแท็บ จึงดึงมาให้ครบก่อน มีเพดานกันวนไม่จบ
const MAX_PAGES = 10

async function loadAllMine() {
    const api = await getServerApi()
    const all: PollSummary[] = []
    let cursor: string | null = null
    for (let i = 0; i < MAX_PAGES; i++) {
        const page = await api.polls.mine({ cursor, limit: 100 })
        all.push(...page.items)
        cursor = page.nextCursor
        if (!cursor) break
    }
    return all
}

export async function MainPage() {
    const polls = await loadOrNotFound(loadAllMine, '/')

    return (
        <div className='relative flex flex-col gap-2'>
            <h1 className=' text-4xl font-bold font-heading'>โพลของคุณ</h1>
            <PollSearch polls={polls} />
            <MainTabs
                renderPanel={(tab) => (
                    <PollGrid
                        polls={polls.filter((poll) => TAB_STATUSES[tab]?.includes(poll.status))}
                        linkTo={pollHref}
                        empty={TAB_EMPTY[tab]}
                    />
                )}
            />
        </div>
    )
}
