'use client'
import React from 'react'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { DateTimePicker } from '@/components/common/dateTimePicker'
import { ImageInput } from '@/components/common/imageInput'
import { useCreatePollStore } from '@/store/createPollStore'

export function PollDetail() {
    const title = useCreatePollStore((s) => s.title)
    const desc = useCreatePollStore((s) => s.desc)
    const openTime = useCreatePollStore((s) => s.openTime)
    const closeTime = useCreatePollStore((s) => s.closeTime)
    const update = useCreatePollStore((s) => s.update)
    // publicUrl จาก POST /images/uploads เก็บใน store แล้วส่งไปเป็น coverImageUrl ตอนบันทึก
    const coverImageUrl = useCreatePollStore((s) => s.coverImageUrl)

    return (
        <div className=' flex flex-col gap-1'>
            <span className='text-xl font-heading font-bold'>ข้อมูลโพล</span>
            <Card>
                <CardContent className='flex flex-col gap-1'>
                    <div>
                        <Label className=' font-bold text-lg'>ชื่อโพล</Label>
                        <Input placeholder='ชื่อโพล...' value={title} onChange={(e) => update({ title: e.target.value })}/>
                    </div>
                    <div>
                        <Label className=' font-bold text-lg'>คำอธิบาย</Label>
                        <Textarea placeholder='คำอธิบายโพล...' value={desc} onChange={(e) => update({ desc: e.target.value })}/>
                    </div>
                    <div className='flex flex-col gap-1'>
                        <Label className=' font-bold text-lg'>เวลาเปิดโพล (ไม่บังคับ)</Label>
                        <DateTimePicker
                            value={openTime ? new Date(openTime) : undefined}
                            onChange={(date) => update({ openTime: date ? date.toISOString() : null })}
                        />
                        <span className='text-sm text-ink-500'>ไม่ตั้ง = เปิดรับโหวตทันทีที่กดเผยแพร่ (โพลทั้งจุฬาฯ ต้องรอผู้ดูแลอนุมัติก่อน)</span>
                    </div>
                    <div className='flex flex-col gap-1'>
                        <Label className=' font-bold text-lg'>เวลาปิดโพล</Label>
                        <DateTimePicker
                            value={closeTime ? new Date(closeTime) : undefined}
                            onChange={(date) => update({ closeTime: date ? date.toISOString() : null })}
                        />
                        <span className='text-sm text-ink-500'>ระบบจะปิดรับโหวตอัตโนมัติเมื่อถึงเวลานี้</span>
                    </div>
                    <ImageInput label='รูปปกโพล' wide hint='แนะนำแนวนอน 16:9 เช่น 1600×900 px · รูปจะถูกครอปให้เต็มกรอบ จึงไม่ควรมีข้อความชิดขอบ' value={coverImageUrl ?? undefined} onChange={(url) => update({ coverImageUrl: url ?? null })} />
                </CardContent>
            </Card>
        </div>
    )
}
