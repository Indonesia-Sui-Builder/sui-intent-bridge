"use client";

import { useState, useCallback, useEffect } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";

// Sui RPC URL & Constants
const PACKAGE_ID = process.env.NEXT_PUBLIC_PACKAGE_ID_SUI || "";

export interface IntentState {
    status: "idle" | "connecting" | "creating" | "waiting_solver" | "fulfilled" | "error";
    intentId?: string;
    suiTxHash?: string;
    ethTxHash?: string;
    error?: string;
}

export interface IntentParams {
    suiAmount: string;
    recipientEvmAddress: string;
}

export function useIntentBridge() {
    const currentAccount = useCurrentAccount();
    const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction();
    const client = useSuiClient();

    const [state, setState] = useState<IntentState>({ status: "idle" });
    const [isPolling, setIsPolling] = useState(false);
    const [metricBalance, setBalance] = useState<string>("0.00");
    const [isLoadingBalance, setIsLoadingBalance] = useState<boolean>(false);
    const [lastTrace, setLastTrace] = useState<string>("Initializing...");

    const trace = (msg: string) => {
        console.log(`[IntentBridge] ${msg}`);
        setLastTrace(msg);
    };

    // Balance Fetching
    const fetchBalance = useCallback(async () => {
        if (!currentAccount?.address) {
            setBalance("0.00");
            return;
        }

        try {
            setIsLoadingBalance(true);
            const result = await client.getBalance({
                owner: currentAccount.address,
                coinType: "0x2::sui::SUI"
            });

            const mist = result.totalBalance || "0";
            setBalance((Number(mist) / 1e9).toFixed(4));
        } catch (err) {
            console.error("Fetch Balance Error:", err);
        } finally {
            setIsLoadingBalance(false);
        }
    }, [currentAccount, client]);

    // Initial and periodic fetch
    useEffect(() => {
        fetchBalance();
        const interval = setInterval(fetchBalance, 10000);
        return () => clearInterval(interval);
    }, [fetchBalance]);

    // Create Intent Logic
    const createIntent = useCallback(async (params: IntentParams) => {
        if (!currentAccount) {
            trace("Wallet not connected");
            return;
        }

        setState({ status: "creating" });
        trace("Creating intent transaction...");

        try {
            const suiMist = BigInt(Math.floor(parseFloat(params.suiAmount) * 1e9));
            const cleanHex = params.recipientEvmAddress.replace("0x", "");
            const evmAddressBytes = new Uint8Array(cleanHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
            const ethExpectedWei = BigInt(Math.floor(parseFloat(params.suiAmount) * 0.0001 * 1e18));

            const tx = new Transaction();
            const [paymentCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(suiMist)]);
            tx.moveCall({
                target: `${PACKAGE_ID}::intent::create_intent`,
                arguments: [paymentCoin, tx.pure.vector("u8", evmAddressBytes), tx.pure.u64(ethExpectedWei)],
            });

            trace("Signing transaction...");
            const res = await signAndExecuteTransaction({
                transaction: tx,
                chain: "sui:testnet" // or based on config
            });

            trace("Transaction sent! Digest: " + res.digest);

            // Wait for indexer/events? Or just assume success if API confirms.
            // But we need event data. Client.waitForTransaction or getTransactionBlock
            const txBlock = await client.waitForTransaction({
                digest: res.digest,
                options: { showEvents: true }
            });

            const intentEvent = txBlock.events?.find((e: any) => e.type.includes("::intent::IntentCreated"));
            if (!intentEvent) throw new Error("Intent event missing in transaction output");

            setState({ status: "waiting_solver", intentId: (intentEvent.parsedJson as any).intent_id, suiTxHash: res.digest });
            setIsPolling(true);
            trace("Waiting for solver...");
        } catch (error: any) {
            trace("CreateIntent failed: " + error.message);
            setState({ status: "error", error: error.message || "Failed to create intent" });
        }
    }, [currentAccount, signAndExecuteTransaction, client]);

    // Polling mechanisms (unchanged mostly, but using client)
    useEffect(() => {
        if (!isPolling || !state.intentId) return;
        const poll = setInterval(async () => {
            try {
                // Using client to query events is better than raw fetch but raw fetch is fine too 
                // if we want to query by MoveEventType generically. 
                // client.queryEvents is available.
                const events = await client.queryEvents({
                    query: { MoveEventType: `${PACKAGE_ID}::intent::IntentClaimed` },
                    limit: 5,
                    order: "descending"
                });

                const claim = events.data.find((e: any) => e.parsedJson?.intent_id === state.intentId);

                if (claim) {
                    trace("SUI CLAIMED! Bridge complete.");
                    setState(prev => ({ ...prev, status: "fulfilled" }));
                    setIsPolling(false);
                    fetchBalance();
                }
            } catch (e) { }
        }, 5000);
        return () => clearInterval(poll);
    }, [isPolling, state.intentId, client, fetchBalance]);

    return {
        state,
        createIntent,
        // Mock connectWallet as it is now handled by UI Button, but keeping for compatibility if needed or removed
        connectWallet: async () => { },
        resetState: () => { setState({ status: "idle" }); setIsPolling(false); },
        isLoading: state.status === "creating" || state.status === "connecting",
        isSuccess: state.status === "fulfilled",
        isError: !!state.error || state.status === "error",
        isLoadingBalance,
        isWalletDetected: true, // abstract away
        availableWallets: [], // abstract away
        selectedWalletId: "adapter",
        selectWallet: () => { },
        lastTrace,
        address: currentAccount?.address || null,
        balance: metricBalance
    };
}
