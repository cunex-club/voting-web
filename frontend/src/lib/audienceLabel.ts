import type { Audience, Faculty } from '@/api/types'
import { AUDIENCE_DESCRIPTION } from '@/lib/pollLabels'

// ขอบเขตแบบมีโครงสร้างของโพล restricted ให้หน้าจอเลือกเองว่าจะย่อแค่ไหน
// departments ว่าง = ทั้งคณะ · years ว่าง = ทุกปีเข้า
export type AudienceGroup = { faculty: string; departments: string[]; years: number[]; departmentCount: number }
export type AudienceScope = { groups: AudienceGroup[]; facultyCount: number; departmentCount: number }

// เรียงตามรหัสคณะ ไม่ใช่ตามลำดับที่ creator กดเลือก โพลที่ขอบเขตเหมือนกันจะได้แสดงลำดับเดียวกัน
// นับสาขา: เลือกทั้งคณะ = นับทุกสาขาของคณะนั้น
export function audienceScope(audience: Audience, faculties: Faculty[]): AudienceScope | null {
    if (audience.type !== 'restricted') return null
    const codes = [...new Set(audience.rules.map((r) => r.facultyCode))].sort()
    const groups = codes.map((code) => {
        const faculty = faculties.find((f) => f.code === code)
        const rules = audience.rules.filter((r) => r.facultyCode === code)
        const wholeFaculty = rules.some((r) => !r.departmentCode)
        const deptCodes = wholeFaculty ? [] : [...new Set(rules.map((r) => r.departmentCode!))]
        const allYears = rules.some((r) => r.studentYear === null)
        return {
            faculty: faculty?.nameTh ?? `คณะรหัส ${code}`,
            departments: deptCodes.map((d) => faculty?.departments?.find((x) => x.code === d)?.nameTh ?? d),
            years: allYears ? [] : [...new Set(rules.map((r) => r.studentYear!))].sort(),
            departmentCount: wholeFaculty ? faculty?.departments?.length ?? 0 : deptCodes.length,
        }
    })
    return { groups, facultyCount: groups.length, departmentCount: groups.reduce((s, g) => s + g.departmentCount, 0) }
}

// ป้ายบรรทัดเดียวของหนึ่งคณะ ครอบสาขา/ปีด้วยวงเล็บ ไม่ให้สับสนว่าเป็นคณะหรือสาขา
export const groupLabel = (g: AudienceGroup) => {
    const parts = [g.departments.length > 0 ? g.departments.join(', ') : 'ทั้งคณะ']
    if (g.years.length > 0) parts.push(`ปีเข้า ${g.years.join(', ')}`)
    return `${g.faculty} (${parts.join(' · ')})`
}

// ข้อความขอบเขตผู้ตอบแบบบรรทัดเดียว ใช้ที่ที่ใส่ปุ่มไม่ได้
export function audienceLabel(audience: Audience, faculties: Faculty[]) {
    if (audience.type === 'codes') {
        const n = audience.codes?.length ?? audience.codeCount
        return n ? `${AUDIENCE_DESCRIPTION.codes} (${n.toLocaleString('th-TH')} รหัส)` : AUDIENCE_DESCRIPTION.codes
    }
    if (audience.type !== 'restricted') return AUDIENCE_DESCRIPTION[audience.type]
    const groups = audienceScope(audience, faculties)?.groups ?? []
    return groups.length > 0 ? groups.map(groupLabel).join(', ') : 'เฉพาะคณะที่กำหนด'
}
