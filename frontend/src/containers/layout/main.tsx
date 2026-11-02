import React from 'react'
import { type ReactNode } from 'react'
import { Navbar } from '../widgets/navbar'
import { NavMenu } from '../widgets/navMenu'

export function MainLayout({ children }: {children:ReactNode}) {
    return (
        <div className='w-full flex flex-col min-h-screen'>
            <Navbar />
            {/* pb-24 เว้นที่ให้เนื้อหาท้ายหน้าเลื่อนพ้นปุ่มเมนูลอยมุมขวาล่าง (สูง 56px + ขอบ 16px) */}
            <div className='grow px-4 pb-24'>
                {children}
            </div>
            <NavMenu />
        </div>
    )
}
