'use client';

import { useState, useMemo, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Dialog,
    DialogContent,
    DialogTrigger,
} from '@/components/ui/dialog'
import { WalletButtonContent } from '@/components/wallet/WalletButton'
import { useCreateSuiIntent } from '../hooks/sui/useCreateSuiIntent'
import { useCreateEvmIntent } from '../hooks/evm/useCreateEvmIntent'

import { useAuctionQuote } from '../hooks/useAuctionQuote'
import { useCurrentAccount as useSuiAccount, useSuiClientQuery } from '@mysten/dapp-kit'
import { useAccount, useBalance } from 'wagmi'
import { motion, AnimatePresence } from 'framer-motion'
import {
    ArrowDown,
    Settings,
    Wallet,
    Loader2,
    ChevronDown,
    Info
} from 'lucide-react'
import { parseUnits, formatUnits } from 'viem'
import { useIntentHistory } from '../hooks/useIntentHistory'
import { ActivityDrawer } from './history/ActivityDrawer'

// Mock Oracle Prices (In real app, fetch from checking API)
const PRICES: Record<string, number> = {
    SUI: 1.85,  // $1.85
    ETH: 2850,  // $2850
    USDC: 1.00, // $1.00
}

// Contract Addresses
const BRIDGE_ADDRESS = process.env.NEXT_PUBLIC_EVM_BRIDGE_ADDRESS as `0x${string}`;
const USDC_ADDRESS = process.env.NEXT_PUBLIC_EVM_USDC_ADDRESS as `0x${string}`;

type Direction = 'evm_to_sui' | 'sui_to_evm'

const ChainBadge = ({ chain }: { chain: 'BASE' | 'SUI' }) => (
    <div className={`absolute -bottom-1 -right-1 px-1 rounded-sm text-[8px] font-bold text-white border border-[#131a2a] ${chain === 'BASE' ? 'bg-blue-600' : 'bg-cyan-500'}`}>
        {chain}
    </div>
)

export function IntentBridge() {
    const { address: evmAddress } = useAccount()
    const suiAccount = useSuiAccount()

    // Custom Hooks
    const createSuiIntent = useCreateSuiIntent()
    const createEvmIntent = useCreateEvmIntent(BRIDGE_ADDRESS, USDC_ADDRESS)
    const { addTransaction } = useIntentHistory()



    // ─── State ─────────────────────────────────────────────────────────────────

    const [direction, setDirection] = useState<Direction>('sui_to_evm')
    const [amount, setAmount] = useState('')
    const [recipient, setRecipient] = useState('')

    // ─── Balance Fetching ──────────────────────────────────────────────────────

    // 1. SUI Balance (Native)
    // SUI has 9 decimals
    const { data: suiBalanceData, isError: isSuiError, error: suiError } = useSuiClientQuery(
        'getBalance',
        { owner: suiAccount?.address || '' },
        {
            enabled: !!suiAccount?.address,
            refetchInterval: 5000
        }
    );

    console.log('DEBUG: SUI Account:', suiAccount?.address);
    console.log('DEBUG: SUI Balance Data:', suiBalanceData);
    if (isSuiError) console.error('DEBUG: SUI Balance Error:', suiError);

    const suiBalance = useMemo(() => {
        if (!suiBalanceData) return '0.00'
        const bal = parseFloat(formatUnits(BigInt(suiBalanceData.totalBalance), 9))
        return bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    }, [suiBalanceData])

    // 2. EVM USDC Balance
    // USDC has 6 decimals
    // We can use wagmi's useReadContract directly here for clarity, or keep using the hook if it works.
    // Let's use the hook's exposed balance for now but ensure it's robust.
    const usdcBalanceRaw = createEvmIntent.balance;

    console.log('DEBUG: EVM Address:', evmAddress);
    console.log('DEBUG: USDC Balance Raw:', usdcBalanceRaw);

    const usdcBalance = useMemo(() => {
        if (usdcBalanceRaw === undefined || usdcBalanceRaw === null) return '0.00'
        const bal = parseFloat(formatUnits(usdcBalanceRaw, 6))
        return bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }, [usdcBalanceRaw])


    // 3. EVM Native ETH Balance
    const { data: ethBalanceData, isError: isEthError, error: ethError } = useBalance({
        address: evmAddress,
        query: {
            enabled: !!evmAddress,
            refetchInterval: 5000
        }
    })

    console.log('DEBUG: ETH Balance Data:', ethBalanceData);
    if (isEthError) console.error('DEBUG: ETH Balance Error:', ethError);

    const ethBalance = useMemo(() => {
        if (!ethBalanceData) return '0.00'
        // ETH has 18 decimals usually
        const bal = parseFloat(formatUnits(ethBalanceData.value, ethBalanceData.decimals))
        return bal.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    }, [ethBalanceData])

    // Current Source Balance based on direction
    const sourceBalance = direction === 'evm_to_sui' ? `${usdcBalance} USDC` : `${suiBalance} SUI`;

    // Pending Intent Data (to save to history on success)
    const pendingIntentRef = useRef<{ amount: string, recipient: string, sourceToken: string, destToken: string } | null>(null);

    // Effect to save EVM intent when orderId is confirmed
    useEffect(() => {
        if (createEvmIntent.orderId && pendingIntentRef.current) {
            addTransaction({
                id: crypto.randomUUID(), // Generate local UUID
                orderId: createEvmIntent.orderId,
                type: 'EVM_TO_SUI',
                inputAmount: pendingIntentRef.current.amount,
                inputToken: 'USDC',
                outputToken: 'SUI',
                expectedOutput: '0', // Need capture expected output or refetch? PendingRef needs this.
                recipient: pendingIntentRef.current.recipient,
                txHash: createEvmIntent.txHash || '',
                status: 'PENDING',
                timestamp: Date.now()
            });
            pendingIntentRef.current = null; // Reset
        }
    }, [createEvmIntent.orderId, addTransaction, createEvmIntent.txHash]);

    // Settings State
    const [durationIdx, setDurationIdx] = useState(1) // 0: 10m, 1: 30m, 2: 1h
    const [slippageIdx, setSlippageIdx] = useState(1) // 0: 0.5%, 1: 1.0%, 2: Auto
    const [maxPremium, setMaxPremium] = useState('2') // %
    const [useWalletAddress, setUseWalletAddress] = useState(true)

    const isConnected = !!(evmAddress && suiAccount)

    // Determine if we need approval (only for EVM -> Sui)
    const needsApproval = useMemo(() => {
        // If any required data is missing, we can't determine needed approval, so assume false or better yet handle loading state.
        // But for the logic bug: strict check against undefined.
        if (direction !== 'evm_to_sui' || !amount) return false;

        // If allowance is loading (undefined), treat as 0 -> Needs Approval (safer than letting Review Order fail)
        const currentAllowance = createEvmIntent.allowance ?? BigInt(0);

        const amountBigInt = parseUnits(amount, 6); // USDC
        // If allowance is 0, this returns true (0 < 100).
        return currentAllowance < amountBigInt;
    }, [direction, amount, createEvmIntent.allowance]);

    const isPending = createSuiIntent.isPending || createEvmIntent.isConfirming || createEvmIntent.isApproving;

    const DURATIONS = [10 * 60, 30 * 60, 60 * 60] // seconds
    const DUATION_LABELS = ['10m', '30m', '1h']
    const SLIPPAGES = [0.5, 1.0, 0.5] // Auto defaults to 0.5 for now

    // ─── Computed ──────────────────────────────────────────────────────────────

    const sourceToken = direction === 'sui_to_evm' ? 'SUI' : 'USDC'
    const destToken = direction === 'sui_to_evm' ? 'ETH' : 'SUI'

    // Determine slippage value
    const activeSlippage = slippageIdx === 2 ? 0.5 : SLIPPAGES[slippageIdx];

    // Smart Quote Hook
    const {
        marketOutput,
        startAmount,
        minAmount,
        isLoading: isQuoteLoading
    } = useAuctionQuote({
        amount,
        sourceToken,
        destToken,
        premiumPct: parseFloat(maxPremium) || 0,
        slippagePct: activeSlippage
    });

    // Recipient Logic
    useEffect(() => {
        if (useWalletAddress) {
            if (direction === 'sui_to_evm' && evmAddress) setRecipient(evmAddress)
            else if (direction === 'evm_to_sui' && suiAccount?.address) setRecipient(suiAccount.address)
        }
    }, [useWalletAddress, direction, evmAddress, suiAccount])


    // ─── Handlers ──────────────────────────────────────────────────────────────

    const toggleDirection = () => {
        setDirection(prev => prev === 'sui_to_evm' ? 'evm_to_sui' : 'sui_to_evm')
        setAmount('') // simple reset
    }

    const handleApprove = async () => {
        if (!amount) return;
        await createEvmIntent.approve(amount);
    }

    const handleSubmit = async () => {
        if (!amount || !marketOutput || !recipient) return

        try {
            const durationSec = DURATIONS[durationIdx]

            console.log('Submitting Order:', {
                amount,
                startAmount,
                minAmount,
                durationSec,
                recipient
            })

            // Store pending details
            pendingIntentRef.current = {
                amount,
                recipient,
                sourceToken,
                destToken
            };

            if (direction === 'sui_to_evm') {
                // SUI -> ETH
                const res = await createSuiIntent.mutateAsync({
                    amountFn: parseFloat(amount),
                    recipientEvm: recipient,
                    startOutputAmountWei: parseUnits(startAmount, 18).toString(),
                    minOutputAmountWei: parseUnits(minAmount, 18).toString(),
                    durationSeconds: durationSec,
                })

                // Save to history immediately for Sui
                if (res.intentId) {
                    addTransaction({
                        id: crypto.randomUUID(), // Generate local UUID
                        orderId: res.intentId,
                        type: 'SUI_TO_EVM',
                        inputAmount: amount,
                        inputToken: 'SUI',
                        outputToken: 'ETH',
                        expectedOutput: minAmount,
                        recipient: recipient,
                        txHash: res.digest,
                        status: 'PENDING',
                        timestamp: Date.now()
                    });
                    pendingIntentRef.current = null;
                }

            } else {
                // USDC -> SUI
                await createEvmIntent.createOrder(
                    amount,
                    startAmount, // Hook handles decimals now? useCreateEvmIntent expects string
                    minAmount,
                    durationSec,
                    recipient,
                )
            }
        } catch (e) {
            console.error("Bridge Error:", e)
        }
    }

    // ─── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="max-w-[480px] mx-auto space-y-4">
            <Card className="w-full border-white/5 bg-[#0d111c] shadow-[0_0_40px_-10px_rgba(0,0,0,0.5)] rounded-3xl overflow-hidden relative">
                <CardContent className="p-4 space-y-1">

                    {/* Header */}
                    <div className="flex items-center justify-between mb-2 px-2">
                        <div className="flex gap-4 text-sm font-medium text-white/50">
                            <button className="text-white hover:opacity-80 transition-opacity">Swap</button>
                            <button className="hover:text-white transition-colors">Limit</button>
                            <button className="hover:text-white transition-colors">Send</button>
                        </div>

                        <div className="flex items-center gap-2">
                            <ActivityDrawer />

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button className="text-white/50 hover:text-white transition-colors p-1 rounded-full hover:bg-white/5">
                                        <Settings className="h-5 w-5" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-[300px] bg-[#131a2a] border-white/10 text-white p-4 rounded-xl shadow-xl backdrop-blur-3xl">
                                    <DropdownMenuLabel className="px-0 pb-3 text-sm font-semibold">Transaction Settings</DropdownMenuLabel>

                                    <div className="space-y-4">
                                        {/* Duration */}
                                        <div>
                                            <div className="flex justify-between mb-2">
                                                <span className="text-xs text-white/50">Auction Duration</span>
                                            </div>
                                            <div className="flex gap-2">
                                                {DUATION_LABELS.map((label, i) => (
                                                    <Button
                                                        key={label}
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setDurationIdx(i)}
                                                        className={`flex-1 h-8 rounded-full text-xs hover:bg-white/10 ${i === durationIdx ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-white/5 border border-transparent'}`}
                                                    >
                                                        {label}
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Slippage */}
                                        <div>
                                            <div className="flex justify-between mb-2">
                                                <span className="text-xs text-white/50">Max Slippage</span>
                                            </div>
                                            <div className="flex gap-2">
                                                {['0.5%', '1.0%', 'Auto'].map((label, i) => (
                                                    <Button
                                                        key={label}
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setSlippageIdx(i)}
                                                        className={`flex-1 h-8 rounded-full text-xs hover:bg-white/10 ${i === slippageIdx ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-white/5 border border-transparent'}`}
                                                    >
                                                        {label}
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Premium */}
                                        <div>
                                            <div className="flex justify-between mb-2">
                                                <span className="text-xs text-white/50 flex items-center gap-1">
                                                    Max Premium
                                                    <Info className="h-3 w-3" />
                                                </span>
                                            </div>
                                            <div className="relative">
                                                <Input
                                                    value={maxPremium}
                                                    onChange={e => setMaxPremium(e.target.value)}
                                                    className="h-9 bg-white/5 border-white/10 text-right pr-8 text-sm focus:border-indigo-500/50"
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-white/50">%</span>
                                            </div>
                                        </div>

                                        <DropdownMenuSeparator className="bg-white/10 my-3" />

                                        {/* Recipient Toggle */}
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-white/60">Use Connected Wallet</span>
                                            <div
                                                onClick={() => setUseWalletAddress(!useWalletAddress)}
                                                className={`w-10 h-5 rounded-full relative cursor-pointer transition-colors ${useWalletAddress ? 'bg-emerald-500/20' : 'bg-white/10'}`}
                                            >
                                                <div className={`absolute top-1 w-3 h-3 rounded-full bg-current transition-all ${useWalletAddress ? 'left-6 text-emerald-400' : 'left-1 text-white/30'}`} />
                                            </div>
                                        </div>

                                    </div>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>

                    {/* ─── You Pay ─────────────────────────────────────────────────── */}
                    <div className="bg-[#131a2a] rounded-2xl p-4 hover:border-white/5 border border-transparent transition-colors">
                        <div className="flex justify-between mb-3 text-sm text-white/40 font-medium">
                            <span>You Pay</span>
                            <div className="flex items-center gap-2">
                                <span>Balance: {sourceBalance}</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                placeholder="0"
                                value={amount}
                                onChange={e => setAmount(e.target.value)}
                                className="w-full bg-transparent text-4xl font-medium text-white placeholder-white/20 outline-none"
                                style={{ appearance: 'none' }}
                            />

                            <div className={`relative flex items-center gap-2 px-3 py-1.5 rounded-full cursor-pointer hover:bg-white/5 transition-colors border border-transparent hover:border-white/10 shrink-0 ${sourceToken === 'SUI' ? 'bg-indigo-500/10' : 'bg-cyan-500/10'}`}>
                                <div className="relative">
                                    <div className={`w-6 h-6 rounded-full ${sourceToken === 'SUI' ? 'bg-indigo-500' : 'bg-cyan-500'}`} />
                                    <ChainBadge chain={direction === 'sui_to_evm' ? 'SUI' : 'BASE'} />
                                </div>
                                <span className="text-lg font-semibold text-white">{sourceToken}</span>
                                <ChevronDown className="h-4 w-4 text-white/50" />
                            </div>
                        </div>

                        <div className="flex justify-between mt-2">
                            <span className="text-xs text-white/30">≈ ${((parseFloat(amount) || 0) * PRICES[sourceToken]).toFixed(2)}</span>
                        </div>
                    </div>

                    {/* ─── Separator ───────────────────────────────────────────────── */}
                    <div className="relative h-2 z-10">
                        <div className="absolute left-1/2 -top-5 -translate-x-1/2">
                            <div className="bg-[#0d111c] p-1.5 rounded-xl">
                                <button
                                    onClick={toggleDirection}
                                    className="bg-[#242b3b] p-2 rounded-xl border-[3px] border-[#0d111c] hover:scale-105 active:scale-95 transition-all group"
                                >
                                    <ArrowDown className="h-4 w-4 text-white/60 group-hover:text-white" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ─── You Receive ─────────────────────────────────────────────── */}
                    <div className="bg-[#131a2a] rounded-2xl p-4 border border-transparent transition-colors">
                        <div className="flex justify-between mb-3 text-sm text-white/40 font-medium">
                            <span>You Receive</span>
                            {/* Destination balance */}
                            <span>Balance: {direction === 'evm_to_sui' ? `${suiBalance} SUI` : `${ethBalance} ETH`}</span>
                        </div>

                        <div className="flex items-center gap-3">
                            <input
                                readOnly
                                placeholder="0"
                                value={marketOutput}
                                className={`w-full bg-transparent text-4xl font-medium placeholder-white/20 outline-none cursor-default ${isQuoteLoading ? 'text-white/30 animate-pulse' : 'text-white/60'}`}
                            />

                            <div className={`relative flex items-center gap-2 px-3 py-1.5 rounded-full cursor-default border border-transparent shrink-0 ${destToken === 'SUI' ? 'bg-indigo-500/10' : 'bg-white/5'}`}>
                                <div className="relative">
                                    <div className={`w-6 h-6 rounded-full ${destToken === 'SUI' ? 'bg-indigo-500' : 'bg-slate-200'}`} />
                                    <ChainBadge chain={direction === 'evm_to_sui' ? 'SUI' : 'BASE'} />
                                </div>
                                <span className="text-lg font-semibold text-white">{destToken}</span>
                            </div>
                        </div>
                        <div className="flex justify-between mt-2">
                            <span className="text-xs text-white/30">
                                {marketOutput ? `≈ $${((parseFloat(marketOutput) || 0) * PRICES[destToken]).toFixed(2)}` : '$0.00'}
                                <span className="ml-1 text-emerald-400">(-0.05%)</span>
                            </span>
                        </div>
                    </div>

                    {/* ─── Manual Address ──────────────────────────────────────────── */}
                    <AnimatePresence>
                        {!useWalletAddress && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden"
                            >
                                <div className="bg-[#131a2a] rounded-xl p-3 mt-1 flex items-center gap-3 border border-amber-500/20">
                                    <Wallet className="h-4 w-4 text-amber-500/50" />
                                    <input
                                        value={recipient}
                                        onChange={e => setRecipient(e.target.value)}
                                        placeholder={`Enter ${destToken} recipient address...`}
                                        className="bg-transparent text-sm w-full outline-none text-amber-100 placeholder-amber-500/30"
                                    />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* ─── CTA ─────────────────────────────────────────────────────── */}

                    <div className="pt-2">
                        {!isConnected ? (
                            <div className="w-full">
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button
                                            fullWidth
                                            size="lg"
                                            className="bg-[#2a3040] text-indigo-300 font-semibold h-14 rounded-2xl hover:bg-[#343b4f]"
                                        >
                                            Connect Wallet
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="bg-[#131a2a] border-white/10 text-white sm:max-w-md">
                                        <WalletButtonContent />
                                    </DialogContent>
                                </Dialog>
                            </div>
                        ) : needsApproval ? (
                            <Button
                                fullWidth
                                size="lg"
                                onClick={handleApprove}
                                disabled={isPending}
                                className="bg-amber-500/10 text-amber-500 border border-amber-500/50 font-bold text-lg h-14 rounded-2xl hover:bg-amber-500/20 transition-all"
                            >
                                {createEvmIntent.isApproving ? (
                                    <div className="flex items-center gap-2">
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        Approving USDC...
                                    </div>
                                ) : (
                                    'Approve USDC'
                                )}
                            </Button>
                        ) : (
                            <Button
                                fullWidth
                                size="lg"
                                onClick={handleSubmit}
                                disabled={isPending || !amount || !marketOutput}
                                className="bg-gradient-to-r from-indigo-500 to-purple-600 font-bold text-lg h-14 rounded-2xl hover:opacity-90 shadow-lg shadow-indigo-500/20 transition-all"
                            >
                                {isPending ? (
                                    <div className="flex items-center gap-2">
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        Sign Transaction
                                    </div>
                                ) : (
                                    `Review Order`
                                )}
                            </Button>
                        )}
                    </div>

                    {/* Quote Info */}
                    {marketOutput && (
                        <div className="mt-4 px-2 space-y-1">
                            <div className="flex justify-between text-xs font-medium text-white/30">
                                <span>Rate</span>
                                <span>1 {sourceToken} = {(PRICES[sourceToken] / PRICES[destToken]).toFixed(4)} {destToken}</span>
                            </div>
                            <div className="flex justify-between text-xs font-medium text-white/30">
                                <span>Estimated Gas</span>
                                <span className="text-emerald-400">~$0.42</span>
                            </div>
                            <div className="flex justify-between text-xs font-medium text-white/30">
                                <span>Start Bid (Premium)</span>
                                <span className="text-indigo-400">{startAmount} {destToken}</span>
                            </div>
                        </div>
                    )}

                </CardContent>
            </Card>

            {/* Dev Tools: Link to Circle Faucet */}
            {direction === 'evm_to_sui' && isConnected && (
                <div className="flex justify-center text-xs text-white/30 gap-1">
                    <span>Need testnet USDC?</span>
                    <a
                        href="https://faucet.circle.com/"
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 transition-colors underline"
                    >
                        Get from Circle Faucet
                    </a>
                </div>
            )}
        </div>
    )
}
