'use client'
import React from 'react'
import { Bookmark } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { usePresetStore } from '@/store/presetStore'
import { useHydrated } from '@/hooks/useHydrated'
import { PresetCard } from './components/presetCard'
import { AddPresetDialog } from './components/addPresetDialog'

// หน้าจัดการ preset รหัส · preset เก็บใน localStorage ของเครื่องนี้ (backend ยังไม่มี) จึงเป็น client component
// เพิ่มได้จากปุ่มลอยมุมขวาล่าง · pb-24 กันการ์ดแถวสุดท้ายถูกปุ่มลอยบัง
export function PresetsPage() {
    const presets = usePresetStore((s) => s.presets)
    const hydrated = useHydrated()

    return (
        <div className='flex flex-col gap-4 pb-24'>
            <div className='flex flex-col gap-1'>
                <h1 className='font-heading text-4xl font-bold'>จัดการ preset</h1>
                <p className='text-base text-ink-500'>preset เก็บไว้ในเครื่องนี้เท่านั้น เปิดจากเครื่องอื่นจะไม่เห็น</p>
            </div>
            {!hydrated ? (
                <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                    {[0, 1, 2].map((i) => <Skeleton key={i} className='h-32 rounded-xl' />)}
                </div>
            ) : presets.length === 0 ? (
                <Empty className='py-12'>
                    <EmptyHeader>
                        <EmptyMedia className='size-16 rounded-full bg-inner-bg text-ink-500'>
                            <Bookmark className='size-8' />
                        </EmptyMedia>
                        <EmptyTitle className='font-heading text-xl font-bold'>ยังไม่มี preset</EmptyTitle>
                        <EmptyDescription className='text-base text-ink-500'>
                            กด &quot;เพิ่ม preset&quot; มุมขวาล่าง หรือกด &quot;บันทึกเป็น preset&quot; ตอนสร้างโพลแบบระบุรหัส
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                    {presets.map((preset) => (
                        <PresetCard key={preset.id} preset={preset} />
                    ))}
                </div>
            )}
            <AddPresetDialog />
        </div>
    )
}
