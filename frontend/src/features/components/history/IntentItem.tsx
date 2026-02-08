
import { IntentTransaction } from '../../hooks/useIntentHistory';
import { usePollIntentStatus } from '../../hooks/usePollIntentStatus';
import { ExternalLink, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils'; // Assuming generic cn utility exists

interface IntentItemProps {
    transaction: IntentTransaction;
}

export function IntentItem({ transaction }: IntentItemProps) {
    // This hook will automatically poll and update the status in localStorage
    usePollIntentStatus(transaction);

    const isPending = transaction.status === 'PENDING';
    const isSettled = transaction.status === 'SETTLED';
    const isFailed = transaction.status === 'FAILED' || transaction.status === 'EXPIRED';

    const explorerUrl = transaction.type === 'SUI_TO_EVM'
        ? `https://suiscan.xyz/testnet/tx/${transaction.txHash}`
        : `https://sepolia.basescan.org/tx/${transaction.txHash}`;

    const destExplorerUrl = transaction.destTxHash
        ? (transaction.type === 'EVM_TO_SUI'
            ? `https://suiscan.xyz/testnet/tx/${transaction.destTxHash}`
            : `https://sepolia.basescan.org/tx/${transaction.destTxHash}`)
        : undefined;

    return (
        <div className="p-4 border-b border-white/5 hover:bg-white/5 transition-colors group">
            <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                    {isPending && <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />}
                    {isSettled && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                    {isFailed && <XCircle className="h-4 w-4 text-red-500" />}

                    <span className={cn(
                        "text-sm font-medium",
                        isPending && "text-amber-500",
                        isSettled && "text-emerald-500",
                        isFailed && "text-red-500"
                    )}>
                        {isPending && "Matching Solver..."}
                        {isSettled && "Completed"}
                        {isFailed && "Failed"}
                    </span>
                </div>
                <span className="text-[10px] text-white/40 font-mono">
                    {new Date(transaction.timestamp).toLocaleTimeString()}
                </span>
            </div>

            <div className="flex justify-between items-center pl-6">
                <div className="flex flex-col">
                    <span className="text-xs text-white/90 font-medium">
                        {transaction.inputAmount} {transaction.inputToken}
                        <span className="text-white/40 mx-1">→</span>
                        {transaction.outputToken}
                    </span>
                    <span className="text-[10px] text-white/40 font-mono mt-0.5">
                        ID: {transaction.orderId.substring(0, 6)}...{transaction.orderId.slice(-4)}
                    </span>
                    {destExplorerUrl && (
                        <a
                            href={destExplorerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-indigo-400 hover:text-indigo-300 mt-1 flex items-center gap-1"
                        >
                            View Destination Tx <ExternalLink className="h-2 w-2" />
                        </a>
                    )}
                </div>

                <div className="flex gap-2">
                    {/* Source Tx */}
                    <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="View Source Transaction"
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                    >
                        <ExternalLink className="h-3 w-3" />
                    </a>
                </div>
            </div>
        </div>
    );
}
