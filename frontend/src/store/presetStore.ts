import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { CodeKind } from "@/lib/codes"

// preset รายชื่อรหัส: ตอนนี้มีแค่ฝั่งเว็บ (backend ยังไม่มี /me/presets) เก็บใน localStorage ของเครื่องนี้
export type CodePreset = { id: string; name: string; codeKind: CodeKind; codes: string[]; createdAt: string }

type UsePresetStore = {
    presets: CodePreset[]
    add: (preset: Pick<CodePreset, 'name' | 'codeKind' | 'codes'>) => void
    rename: (id: string, name: string) => void
    remove: (id: string) => void
}

export const usePresetStore = create<UsePresetStore>()(
    persist(
        (set) => ({
            presets: [],
            // ใหม่สุดก่อน
            add: (preset) => set((s) => ({
                presets: [{ ...preset, id: crypto.randomUUID(), createdAt: new Date().toISOString() }, ...s.presets],
            })),
            rename: (id, name) => set((s) => ({ presets: s.presets.map((p) => (p.id === id ? { ...p, name } : p)) })),
            remove: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
        }),
        {
            name: 'code-presets',
            storage: createJSONStorage(() => localStorage),
            partialize: (s) => ({ presets: s.presets }),
            version: 1,
        }
    )
)
