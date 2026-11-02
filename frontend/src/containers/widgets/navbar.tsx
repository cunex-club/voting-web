import { ReturnButton } from '@/components/common/return'
import { LeaveDialog } from '@/components/common/leaveDialog'
import AvatarPopup from './components/avator-popup'

export function Navbar() {
    return (
        <div className=' w-full h-20 shrink-0 flex items-center justify-between px-6'>
            <div>
                <ReturnButton/>
            </div>
            <AvatarPopup/>
            <LeaveDialog/>
        </div>
    )
}
