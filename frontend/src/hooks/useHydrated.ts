import { useSyncExternalStore } from 'react'

// false ตอน server render และรอบ hydrate แรก แล้วเป็น true ฝั่ง browser
// ใช้กับ store ที่อ่านจาก localStorage ไม่ให้ HTML จาก server ไม่ตรงกับรอบแรกของ client
const subscribeNoop = () => () => {}
export const useHydrated = () => useSyncExternalStore(subscribeNoop, () => true, () => false)
