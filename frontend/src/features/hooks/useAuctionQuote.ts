import { useState, useEffect } from 'react';

// Mock Prices
const MOCK_PRICES: Record<string, number> = {
    SUI: 1.85,  // $1.85
    ETH: 2850,  // $2850
    USDC: 1.00, // $1.00
};

export interface AuctionQuoteParams {
    amount: string;
    sourceToken: 'SUI' | 'USDC' | 'ETH'; // ETH isn't a source in existing flows? 
    // Wait, existing flow is SUI->EVM (SUI inputs) or EVM->SUI (USDC inputs usually). 
    // The User Request examples suggested USDC -> SUI.
    // Let's allow general tokens.
    destToken: 'SUI' | 'USDC' | 'ETH';
    premiumPct: number; // e.g., 5 for 5%
    slippagePct: number; // e.g., 1 for 1%
}

export interface AuctionQuoteResult {
    marketOutput: string;
    startAmount: string; // High bid
    minAmount: string;   // Floor price
    isLoading: boolean;
    error: string | null;
}

export function useAuctionQuote({
    amount,
    sourceToken,
    destToken,
    premiumPct = 2.0, // Default premium
    slippagePct = 0.5 // Default slippage
}: AuctionQuoteParams): AuctionQuoteResult {
    const [quote, setQuote] = useState<Omit<AuctionQuoteResult, 'isLoading' | 'error'>>({
        marketOutput: '',
        startAmount: '',
        minAmount: '',
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchQuote = async () => {
            // Basic validation
            if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
                setQuote({ marketOutput: '', startAmount: '', minAmount: '' });
                setError(null);
                return;
            }

            setIsLoading(true);
            setError(null);

            // Simulate API delay
            // await new Promise(resolve => setTimeout(resolve, 500)); 
            // Debouncing is handled by the useEffect cleanup, but here we just simulate the async fetch time.
            // Actually, the requirement asks for "Debouncing: Use a debounce (500ms) on the input".
            // The debounce should be on the EFFECT trigger, or inside.

            try {
                // 1. Get Prices
                const inputPrice = MOCK_PRICES[sourceToken] || 0;
                const outputPrice = MOCK_PRICES[destToken] || 0;

                if (inputPrice === 0 || outputPrice === 0) {
                    throw new Error('Price not found');
                }

                // 2. Calculate Market Value
                const inputVal = parseFloat(amount);
                const valueUSD = inputVal * inputPrice;
                const marketOut = valueUSD / outputPrice;

                // 3. Calculate Auction Params
                // Premium: The "Start Amount" for the auction (User pays this much? No, user RECEIVES this much ideally, but wait.)

                // RE-READING CONTEXT:
                // "startAmount (High Bid) = marketOutput * 1.05 (5% Premium)."
                // "minAmount (Floor Price) = marketOutput * 0.99 (1% Slippage)."

                // This math assumes the auction is for the OUTPUT amount the user RECEIVES.
                // i.e., I put in 100 USDC. Market says I get 50 SUI.
                // Auction starts asking for 52.5 SUI (High Bid).
                // Auction drops until 49.5 SUI (Floor).
                // Correct.

                const startAmt = marketOut * (1 + premiumPct / 100);
                const minAmt = marketOut * (1 - slippagePct / 100);

                setQuote({
                    marketOutput: marketOut.toFixed(6),
                    startAmount: startAmt.toFixed(6),
                    minAmount: minAmt.toFixed(6),
                });

            } catch (err) {
                setError('Failed to calculate quote');
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        };

        // Debounce Logic
        const timer = setTimeout(() => {
            if (amount) fetchQuote();
        }, 500);

        return () => clearTimeout(timer);
    }, [amount, sourceToken, destToken, premiumPct, slippagePct]);

    return {
        ...quote,
        isLoading,
        error
    };
}
