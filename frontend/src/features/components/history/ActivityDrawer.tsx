
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import { History } from "lucide-react"
import { useIntentHistory } from "../../hooks/useIntentHistory"
import { IntentItem } from "./IntentItem"
// Removed ScrollArea import to avoid another missing component issue for now, using native scroll

export function ActivityDrawer() {
    const { transactions } = useIntentHistory();

    return (
        <Sheet>
            <SheetTrigger asChild>
                <button className="text-white/50 hover:text-white transition-colors p-2 rounded-full hover:bg-white/5 relative group">
                    <History className="h-5 w-5" />
                    {transactions.some(t => t.status === 'PENDING') && (
                        <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                    )}
                </button>
            </SheetTrigger>
            <SheetContent className="w-[400px] bg-[#0d111c] border-l border-white/10 text-white p-0 sm:max-w-[400px]">
                <SheetHeader className="p-6 border-b border-white/5">
                    <SheetTitle className="text-white text-lg font-semibold flex justify-between items-center">
                        Activity
                        <span className="text-xs font-normal text-white/40 bg-white/5 px-2 py-0.5 rounded-full">
                            {transactions.length}
                        </span>
                    </SheetTitle>
                </SheetHeader>

                <div className="h-[calc(100vh-80px)] overflow-y-auto">
                    {transactions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-white/30 space-y-3">
                            <History className="h-12 w-12 opacity-20" />
                            <p className="text-sm">No recent transactions</p>
                        </div>
                    ) : (
                        <div className="flex flex-col">
                            {transactions.map((tx) => (
                                <IntentItem key={tx.id} transaction={tx} />
                            ))}
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    )
}
