'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { useConnect, useAccount, useDisconnect } from 'wagmi';
import { useCurrentAccount, useConnectWallet, useDisconnectWallet, useWallets } from '@mysten/dapp-kit';
import { Wallet, LogOut, ChevronRight, Check } from 'lucide-react';

export function WalletButtonContent() {
    // EVM Hooks
    const { address: evmAddress, isConnected: isEvmConnected } = useAccount();
    const { connect, connectors } = useConnect();
    const { disconnect: disconnectEvm } = useDisconnect();

    // Sui Hooks
    const suiAccount = useCurrentAccount();
    const { mutate: connectSui } = useConnectWallet();
    const { mutate: disconnectSui } = useDisconnectWallet();
    const wallets = useWallets();

    const isEvmConnectedBool = !!evmAddress;
    const isSuiConnectedBool = !!suiAccount;

    const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

    return (
        <>
            <DialogHeader>
                <DialogTitle>Connect Wallets</DialogTitle>
            </DialogHeader>

            <div className="space-y-6 py-4">

                {/* EVM Section */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm text-white/50 font-medium">
                        <span>EVM (Base Sepolia)</span>
                        {isEvmConnectedBool && (
                            <span className="text-emerald-400 flex items-center gap-1">
                                <Check className="h-3 w-3" /> Connected
                            </span>
                        )}
                    </div>

                    {isEvmConnectedBool ? (
                        <div className="bg-white/5 rounded-xl p-3 flex items-center justify-between border border-emerald-500/20">
                            <span className="font-mono text-sm">{formatAddress(evmAddress!)}</span>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => disconnectEvm()}
                                className="h-8 w-8 p-0 hover:bg-red-500/20 hover:text-red-400"
                            >
                                <LogOut className="h-4 w-4" />
                            </Button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2">
                            {connectors.filter(c => c.id !== 'injected').map((connector) => (
                                <Button
                                    key={connector.uid}
                                    onClick={() => {
                                        connect({ connector });
                                        // Don't close immediately, let them connect Sui too
                                    }}
                                    className="justify-between bg-[#0d111c] hover:bg-[#1a2235] border border-white/5 h-12 rounded-xl"
                                >
                                    <div className="flex items-center gap-2">
                                        {/* Ideally icons here */}
                                        <span>{connector.name}</span>
                                    </div>
                                    <ChevronRight className="h-4 w-4 text-white/30" />
                                </Button>
                            ))}
                            {/* Fallback for injected if no others found or just show generic */}
                            {connectors.length === 0 && (
                                <div className="text-sm text-white/30 text-center py-2">No connectors found</div>
                            )}
                        </div>
                    )}
                </div>

                <div className="h-px bg-white/10" />

                {/* Sui Section */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm text-white/50 font-medium">
                        <span>Sui Network</span>
                        {isSuiConnectedBool && (
                            <span className="text-emerald-400 flex items-center gap-1">
                                <Check className="h-3 w-3" /> Connected
                            </span>
                        )}
                    </div>

                    {isSuiConnectedBool ? (
                        <div className="bg-white/5 rounded-xl p-3 flex items-center justify-between border border-cyan-500/20">
                            <span className="font-mono text-sm">{formatAddress(suiAccount!.address)}</span>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => disconnectSui()}
                                className="h-8 w-8 p-0 hover:bg-red-500/20 hover:text-red-400"
                            >
                                <LogOut className="h-4 w-4" />
                            </Button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2">
                            {wallets.map((wallet) => (
                                <Button
                                    key={wallet.name}
                                    onClick={() => {
                                        connectSui({ wallet });
                                    }}
                                    className="justify-between bg-[#0d111c] hover:bg-[#1a2235] border border-white/5 h-12 rounded-xl"
                                >
                                    <div className="flex items-center gap-2">
                                        <img src={wallet.icon} alt={wallet.name} className="h-5 w-5 rounded-full" />
                                        <span>{wallet.name}</span>
                                    </div>
                                    <ChevronRight className="h-4 w-4 text-white/30" />
                                </Button>
                            ))}
                            {wallets.length === 0 && (
                                <div className="text-sm text-white/30 text-center py-2">
                                    No Sui wallets detected. Please install Sui Wallet.
                                </div>
                            )}
                        </div>
                    )}
                </div>

            </div>
        </>
    );
}

export function WalletButton() {
    const [isOpen, setIsOpen] = useState(false);

    // Hooks for button state only
    const { address: evmAddress } = useAccount();
    const suiAccount = useCurrentAccount();

    const isEvmConnectedBool = !!evmAddress;
    const isSuiConnectedBool = !!suiAccount;

    const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="outline"
                    className="bg-white/5 border-white/10 hover:bg-white/10 text-white font-medium rounded-xl h-10 px-4 flex items-center gap-2"
                >
                    <Wallet className="h-4 w-4 text-indigo-400" />
                    {isEvmConnectedBool && isSuiConnectedBool ? (
                        <span>2 Wallets Connected</span>
                    ) : isEvmConnectedBool ? (
                        <span>{formatAddress(evmAddress!)} (EVM)</span>
                    ) : isSuiConnectedBool ? (
                        <span>{formatAddress(suiAccount!.address)} (Sui)</span>
                    ) : (
                        <span>Connect Wallet</span>
                    )}
                </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#131a2a] border-white/10 text-white sm:max-w-md">
                <WalletButtonContent />
            </DialogContent>
        </Dialog>
    );
}
