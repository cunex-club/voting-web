'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { api, errorMessage } from '@/api'

const STUDENT_ID_PATTERN = /^\d{10}$/

// ปุ่มลอยมุมขวาล่างเหมือนปุ่มสร้างโพล เปิด dialog ให้กรอกรหัสนิสิต
export function AddAdminDialog() {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [studentId, setStudentId] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    const handleOpenChange = (next: boolean) => {
        if (pending) return
        setOpen(next)
        if (!next) {
            setStudentId('')
            setError(null)
        }
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!STUDENT_ID_PATTERN.test(studentId)) {
            setError('รหัสนิสิตต้องเป็นตัวเลข 10 หลัก')
            return
        }
        setPending(true)
        setError(null)
        try {
            await api.admin.addAdmin(studentId)
            handleOpenChange(false)
            router.refresh()
        } catch (err) {
            // USER_NOT_FOUND: คนนั้นต้องเข้าสู่ระบบด้วย CUNEX ก่อนหนึ่งครั้ง (ข้อความมาจาก API)
            setError(errorMessage(err, 'เพิ่มแอดมินไม่สำเร็จ'))
        } finally {
            setPending(false)
        }
    }

    return (
        <>
            <Button className='fixed bottom-4 right-20 h-14 shadow-md font-heading text-lg font-bold px-4' onClick={() => setOpen(true)}>
                <UserPlus className='size-5' />
                เพิ่ม admin
            </Button>
            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent>
                    <form onSubmit={submit} className='flex flex-col gap-4'>
                        <DialogHeader>
                            <DialogTitle className='font-heading text-xl font-bold'>เพิ่มผู้ดูแลระบบ</DialogTitle>
                            <DialogDescription className='text-base'>กรอกรหัสนิสิต 10 หลักของผู้ที่ต้องการให้สิทธิ์แอดมิน</DialogDescription>
                        </DialogHeader>
                        <div className='flex flex-col gap-1'>
                            <Label htmlFor='admin-student-id' className='text-lg font-bold'>รหัสนิสิต</Label>
                            <Input
                                id='admin-student-id'
                                inputMode='numeric'
                                maxLength={10}
                                placeholder='6xxxxxxxxx'
                                value={studentId}
                                aria-invalid={error !== null}
                                onChange={(e) => {
                                    setStudentId(e.target.value.replace(/\D/g, ''))
                                    setError(null)
                                }}
                            />
                            {error && <p role='alert' className='text-base text-destructive'>{error}</p>}
                        </div>
                        <DialogFooter>
                            <Button type='button' variant='outline' disabled={pending} className={` font-heading font-bold w-26 cursor-pointer`} onClick={() => handleOpenChange(false)}>ยกเลิก</Button>
                            <Button type='submit' disabled={pending} className={` font-heading font-bold w-26 cursor-pointer`} aria-busy={pending}>
                                {pending && <Loader2 className='animate-spin' />}
                                เพิ่ม
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
