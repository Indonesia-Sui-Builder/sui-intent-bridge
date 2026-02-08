"use client";

import { IntentBridge } from "@/features/components/IntentBridge";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-12 bg-[#020617] text-white">
      <div className="mb-8 text-center space-y-2">
        <h1 className="text-4xl font-black tracking-tighter bg-gradient-to-r from-blue-400 via-white to-cyan-400 bg-clip-text text-transparent">
          Cross-Chain Intent Bridge
        </h1>
        <p className="text-slate-400 font-medium">Dutch Auction mechanism for optimal execution</p>
      </div>
      <IntentBridge />
    </div>
  );
}
