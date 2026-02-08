import { ethers } from "ethers";

export const ONE_CLICK_BASE_URL = "https://api.near-intents.org";

export interface Token {
    blockchain: string;
    address: string;
    symbol: string;
    decimals: number;
    name: string;
    priceUsd: string;
}

export interface QuoteRequest {
    fromToken: string;
    toToken: string;
    fromChain: string;
    toChain: string;
    amountIn: string;
    recipient: string;
    refundTo: string;
    slippage?: number;
}

export interface QuoteResponse {
    quoteId: string;
    depositAddress: string;
    amountIn: string;
    amountOut: string;
    minAmountOut: string;
    deadline: number;
    timeWhenInactive: number;
    fee: string;
}

export interface SwapStatus {
    status: "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";
    txHash?: string;
    errorMessage?: string;
}

export class OneClickAPI {
    static async getTokens(): Promise<Token[]> {
        const res = await fetch(`${ONE_CLICK_BASE_URL}/v0/tokens`);
        return res.json();
    }

    static async requestQuote(req: QuoteRequest): Promise<QuoteResponse> {
        const res = await fetch(`${ONE_CLICK_BASE_URL}/v0/quote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ...req,
                amountInterpretMode: "EXACT_INPUT",
                depositAddressMode: "SIMPLE",
            }),
        });
        if (!res.ok) throw new Error("Failed to get quote");
        return res.json();
    }

    static async getStatus(depositAddress: string): Promise<SwapStatus> {
        const res = await fetch(`${ONE_CLICK_BASE_URL}/v0/status?depositAddress=${depositAddress}`);
        if (!res.ok) throw new Error("Failed to get status");
        return res.json();
    }
}
