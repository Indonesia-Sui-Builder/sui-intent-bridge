"use client";

import { useState, useCallback, useEffect } from "react";
import { OneClickAPI, QuoteResponse, SwapStatus, Token } from "@/lib/one-click";

export function useBridge() {
    const [loading, setLoading] = useState(false);
    const [tokens, setTokens] = useState<Token[]>([]);
    const [quote, setQuote] = useState<QuoteResponse | null>(null);
    const [status, setStatus] = useState<SwapStatus | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        OneClickAPI.getTokens().then(setTokens).catch(err => setError(err.message));
    }, []);

    const getQuote = useCallback(async (params: {
        fromToken: string;
        toToken: string;
        fromChain: string;
        toChain: string;
        amountIn: string;
        recipient: string;
        refundTo: string;
    }) => {
        setLoading(true);
        setError(null);
        try {
            const res = await OneClickAPI.requestQuote(params);
            setQuote(res);
            setStatus({ status: "PENDING_DEPOSIT" });
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const pollStatus = useCallback(async () => {
        if (!quote?.depositAddress) return;
        try {
            const res = await OneClickAPI.getStatus(quote.depositAddress);
            setStatus(res);
        } catch (err) {
            console.error("Polling error:", err);
        }
    }, [quote]);

    // Status polling logic
    useEffect(() => {
        if (status?.status === "PENDING_DEPOSIT" || status?.status === "PROCESSING") {
            const interval = setInterval(pollStatus, 5000);
            return () => clearInterval(interval);
        }
    }, [status, pollStatus]);

    return {
        tokens,
        loading,
        quote,
        status,
        error,
        getQuote,
    };
}
