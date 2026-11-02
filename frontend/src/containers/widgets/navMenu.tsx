"use client"
import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import gsap from 'gsap'
import { Bookmark, Compass, Home, Menu, Plus, UserStar, X, type LucideIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGuardedNavigate } from '@/hooks/useGuardedNavigate'
import { useMe } from '@/containers/providers/meProvider'

type NavItem = { href: string; label: string; icon: LucideIcon; match: (path: string) => boolean; adminOnly?: boolean }

// เรียงจากบนลงล่าง ตัวล่างสุด (ใกล้ปุ่มเมนู) คือ action หลัก "สร้างโพล"
const NAV_ITEMS: NavItem[] = [
    { href: '/admin', label: 'admin', icon: UserStar, match: (p) => p === '/admin' || p.startsWith('/admin/'), adminOnly: true },
    { href: '/presets', label: 'จัดการ preset', icon: Bookmark, match: (p) => p === '/presets' },
    { href: '/explore', label: 'โพลที่ตอบได้', icon: Compass, match: (p) => p === '/explore' },
    { href: '/', label: 'โพลของฉัน', icon: Home, match: (p) => p === '/' },
    { href: '/create', label: 'สร้างโพล', icon: Plus, match: (p) => p === '/create' || p.startsWith('/create/') },
]

// เมนูนำทางหลักมุมขวาล่าง อยู่ทุกหน้าใน (main) และ admin: กดแล้วปุ่มเด้งออกมาทีละปุ่มพร้อมพื้นหลังเบลอ
// ปิดได้ด้วยกดปุ่มเมนูอีกครั้ง แตะพื้นหลัง หรือกด Escape
export function NavMenu() {
    const pathname = usePathname()
    const me = useMe()
    const guard = useGuardedNavigate()
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const backdropRef = useRef<HTMLDivElement>(null)
    const itemsRef = useRef<HTMLDivElement>(null)
    const timeline = useRef<gsap.core.Timeline | null>(null)

    const items = NAV_ITEMS.filter((item) => !item.adminOnly || me?.role === 'admin')

    // สร้าง timeline ใหม่เมื่อจำนวนปุ่มเปลี่ยน (เมนู admin โผล่/หาย) เล่นไปข้างหน้าตอนเปิด และเล่นย้อนตอนปิด
    useEffect(() => {
        const children = itemsRef.current?.children
        if (!children || !backdropRef.current) return
        const ctx = gsap.context(() => {
            // ขยับแค่ transform/opacity, ไม่มี overshoot และให้ปุ่มที่อยู่ใกล้ปุ่มเมนูขึ้นก่อน (stagger from end)
            // ปุ่มย่อขยายจากมุมขวาล่างให้ดูเหมือนงอกออกมาจากปุ่มเมนู
            // y ต้องไม่เกินช่องว่าง gap-2 (8px) ไม่งั้นระหว่าง animation ปุ่มย่อยจะทับปุ่มเมนูแล้วรับคลิกแทน
            gsap.set(children, { transformOrigin: 'right bottom', force3D: true })
            timeline.current = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' } })
                .fromTo(backdropRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, ease: 'power2.out' }, 0)
                .fromTo(
                    children,
                    { y: 8, opacity: 0, scale: 0.8 },
                    { y: 0, opacity: 1, scale: 1, duration: 0.5, stagger: { each: 0.06, from: 'end' } },
                    0,
                )
        }, rootRef)
        return () => {
            timeline.current = null
            ctx.revert()
        }
    }, [items.length])

    // คนที่ตั้งค่าลดการเคลื่อนไหวไว้ให้เปลี่ยนสถานะทันที ไม่เล่น animation
    const play = (next: boolean) => {
        const tl = timeline.current
        if (!tl) return
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        if (reduce) tl.progress(next ? 1 : 0)
        // ตอนปิดเล่นเร็วขึ้น ของที่หายไปควรเร็วกว่าของที่โผล่มา
        else if (next) tl.timeScale(1).play()
        else tl.timeScale(1.6).reverse()
    }

    const toggle = () => {
        const next = !open
        setOpen(next)
        play(next)
    }

    const close = () => {
        if (!open) return
        setOpen(false)
        play(false)
    }

    useEffect(() => {
        if (!open) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
        // close ใช้ state ปัจจุบันเท่านั้น จึงผูกกับ open พอ
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    // พื้นทึบ + เงาบาง เพราะปุ่มลอยทับการ์ดโพล ถ้าโปร่งจะเห็นตัวอักษรด้านหลังซ้อนกัน
    // buttonVariants มี transition-all กับ active:translate-y-px ซึ่งจะไปไล่ค่า opacity/transform ที่ GSAP ตั้งทุกเฟรมซ้อนอีกชั้น
    // จึงเหลือ transition เฉพาะสี (hover) และตัดการขยับตอนกด ให้ GSAP คุม transform/opacity ฝ่ายเดียว
    const itemClass = (active: boolean) => cn(
        buttonVariants({ variant: 'outline' }),
        'rounded-full bg-background px-4 py-5 text-lg font-bold font-heading shadow-sm',
        'transition-colors active:not-aria-[haspopup]:translate-y-0',
        active && 'bg-secondary text-rose-900',
    )

    return (
        <>
            {/* แตะพื้นหลังเพื่อปิด และกันไม่ให้แตะโดนการ์ดข้างหลังโดยไม่ตั้งใจ · autoAlpha ซ่อนด้วย visibility ตอนปิดจึงไม่รับคลิก */}
            <div
                ref={backdropRef}
                aria-hidden
                className='invisible fixed inset-0 z-40 bg-background/30 opacity-0 backdrop-blur-xs'
                onClick={close}
            />
            {/* หน้าที่มีแถบปุ่มติดขอบล่าง (data-bottom-bar) ยกเมนูขึ้นพ้นแถบ ไม่งั้นปุ่มเมนูจะทับปุ่มยืนยันของหน้านั้น
                กล่องนี้กว้างเท่าปุ่มที่ยาวที่สุดในเมนู จึงปิดการรับคลิกของกล่อง ให้รับเฉพาะตัวปุ่ม ไม่งั้นจะบังปุ่มของหน้าที่อยู่ซ้ายปุ่มเมนู */}
            <div
                ref={rootRef}
                className='pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 [body:has([data-bottom-bar])_&]:bottom-22'
            >
                {/* inert ตอนปิด เพื่อไม่ให้กดหรือโฟกัสปุ่มที่มองไม่เห็น */}
                <nav ref={itemsRef} id='nav-menu' aria-label='เมนูหลัก' inert={!open} className={cn('flex flex-col items-end gap-2', open && '*:pointer-events-auto')}>
                    {items.map(({ href, label, icon: Icon, match }) => {
                        const active = match(pathname)
                        return (
                            <Link
                                key={href}
                                href={href}
                                aria-current={active ? 'page' : undefined}
                                className={itemClass(active)}
                                onClick={(e) => {
                                    close()
                                    guard(href, e)
                                }}
                            >
                                <Icon className='size-5' />
                                {label}
                            </Link>
                        )
                    })}
                </nav>
                <Button
                    type='button'
                    size='icon'
                    aria-label={open ? 'ปิดเมนู' : 'เปิดเมนู'}
                    aria-expanded={open}
                    aria-controls='nav-menu'
                    className='pointer-events-auto size-14 py-0 shadow-md'
                    onClick={toggle}
                >
                    {/* ไอคอนเมนู (ไม่ใช่ +) เพราะปุ่มนี้คือทางไปทุกหน้า ไม่ได้มีไว้สร้างโพลอย่างเดียว */}
                    {open ? <X className='size-7' /> : <Menu className='size-7' />}
                </Button>
            </div>
        </>
    )
}
