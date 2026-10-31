'use client'
import React from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from '@/components/ui/button'
import { ChevronDown, LogOut, User } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useGuardedNavigate } from '@/hooks/useGuardedNavigate'
import { useMe } from '@/containers/providers/meProvider'

// เมนูโปรไฟล์: ข้อมูลจาก GET /me กับปุ่มออกจากระบบ · การไปหน้าต่างๆ อยู่ที่เมนูลอยมุมขวาล่าง (navMenu.tsx)
function AvatarPopup() {
    const router = useRouter()
    const guard = useGuardedNavigate()
    const me = useMe()
    const go = (href: string) => { if (!guard(href)) router.push(href) }

    const title = me?.studentId ? `รหัส ${me.studentId}` : 'ผู้ใช้ CUNEX'
    const detail = me?.faculty
        ? `${me.faculty.nameTh}${me.studentYear ? ` · ปีเข้า ${me.studentYear}` : ''}`
        : 'ไม่มีข้อมูลคณะ'

    return (
        <Popover>
            {/* ทรงแคปซูลมีกรอบและลูกศร ให้ดูออกว่าเป็นปุ่มเปิดเมนู (วงกลมเปล่าที่มีเลขรหัส 2 ตัวดูเหมือนป้ายมากกว่าปุ่ม) */}
            <PopoverTrigger
                aria-label='เมนูผู้ใช้'
                className={cn(
                    'flex h-11 items-center gap-1.5 rounded-full border border-primary bg-background py-1 pr-2.5 pl-1',
                    'text-base font-bold font-heading text-rose-900',
                    'cursor-pointer transition-colors hover:bg-secondary aria-expanded:bg-secondary',
                    'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                )}
            >
                <span className='flex size-9 items-center justify-center rounded-full bg-secondary'>
                    <User className='size-5' />
                </span>
                {/* จอแคบเหลือแค่ไอคอน + ลูกศร กันชนปุ่มย้อนกลับ */}
                <span className='hidden sm:inline'>{me?.studentId ?? 'บัญชี'}</span>
                <ChevronDown className='size-4' />
            </PopoverTrigger>
            <PopoverContent align='end' className={` w-60 overflow-hidden`}>
                <div>
                    <p className='text-xl font-bold font-heading leading-10'>{title}</p>
                    <p className='text-sm text-ink-500'>{detail}</p>
                    {me?.role === 'admin' && <p className='text-sm text-ink-500'>ผู้ดูแลระบบ</p>}
                </div>
                <hr />
                <Button onClick={() => go('/logout')} variant={'ghost'} className={`text-base text-destructive font-bold`}>
                    <LogOut/>ออกจากระบบ
                </Button>
            </PopoverContent>
        </Popover>
    )
}

export default AvatarPopup
