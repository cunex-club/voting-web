// ขอบเขตแบบ "ระบุรหัส" และ preset รายชื่อรหัส (preset ยังเก็บแค่ในเครื่อง ดู presetStore)
// ใช้ร่วมกันระหว่างหน้าสร้างโพลกับหน้าจัดการ preset

export type CodeKind = 'STUDENT' | 'STAFF'

// รูปแบบรหัส: นิสิตจุฬาฯ 10 หลัก บุคลากร 8 หลัก (ตัวเลขทั้งหมด)
export const CODE_PATTERNS: Record<CodeKind, RegExp> = {
    STUDENT: /^\d{10}$/,
    STAFF: /^\d{8}$/,
}

export const CODE_LENGTH: Record<CodeKind, number> = {
    STUDENT: 10,
    STAFF: 8,
}

export const CODE_KIND_LABEL: Record<CodeKind, string> = {
    STUDENT: 'นิสิต',
    STAFF: 'บุคลากร',
}

export const CODE_KIND_ITEMS: { label: string; value: CodeKind }[] = [
    { label: 'นิสิต (10 หลัก)', value: 'STUDENT' },
    { label: 'บุคลากร (8 หลัก)', value: 'STAFF' },
]

export const CODE_PLACEHOLDER: Record<CodeKind, string> = {
    STUDENT: '6400000001\n6400000002\n6400000003',
    STAFF: '12345678\n23456789\n34567890',
}

// หนึ่งรหัสต่อบรรทัด ตัดช่องว่างและบรรทัดว่างทิ้ง ไม่เอารหัสซ้ำ
export const parseCodes = (text: string) => [...new Set(text.split('\n').map((line) => line.trim()).filter(Boolean))]

export const PRESET_NAME_MAX = 60
