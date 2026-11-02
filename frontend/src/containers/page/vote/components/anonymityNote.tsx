import React from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

// บอกผู้ตอบว่าเจ้าของโพลไม่เห็นตัวตน (System flow §8) ใช้ซ้ำในหน้าแรกของโพลและ dialog ยืนยันส่ง
// identified = โพลระบุคนส่ง: กลับกัน เจ้าของเห็นรหัสของผู้ตอบ ต้องบอกตรงๆ
export function AnonymityNote({ className, identified = false }: { className?: string; identified?: boolean }) {
    return (
        <p className={cn('flex items-center justify-center gap-1.5 text-sm text-ink-500', identified && 'font-bold text-ink-700', className)}>
            <Info className='size-4 shrink-0' />
            {identified ? 'เจ้าของโพลจะเห็นรหัสนิสิต/บุคลากรของคุณคู่กับคำตอบ' : 'ระบบจะไม่แสดงชื่อผู้ตอบให้เจ้าของโพลเห็น'}
        </p>
    )
}
