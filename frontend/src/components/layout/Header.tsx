'use client';

import { WalletButton } from '../wallet/WalletButton';

export function Header() {
    return (
        <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-[#020617]/80 backdrop-blur-md">
            <div className="container flex h-16 items-center justify-between mx-auto px-4 md:px-6">
                <div className="flex items-center gap-2">
                    {/* Placeholder Logo */}
                    <div className="h-8 w-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-5 w-5 text-white"
                        >
                            <path d="M17 2.5h-5.9a3.3 3.3 0 0 0-3.3 3.3v13.59a3.3 3.3 0 0 0 3.3 3.3h5.9a3.3 3.3 0 0 0 3.3-3.3V5.8a3.3 3.3 0 0 0-3.3-3.3z" />
                            <path d="M12 7v4" />
                            <path d="M12 15h.01" />
                        </svg>
                    </div>
                    <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
                        Sui Intent Bridge
                    </span>
                </div>

                <div className="flex items-center gap-4">
                    <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-white/60">
                        <a href="#" className="hover:text-white transition-colors">Bridge</a>
                        <a href="#" className="hover:text-white transition-colors">History</a>
                        <a href="#" className="hover:text-white transition-colors">Stats</a>
                    </nav>
                    <WalletButton />
                </div>
            </div>
        </header>
    );
}
