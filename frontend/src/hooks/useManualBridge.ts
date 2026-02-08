"use client";

import { useState, useCallback } from "react";
import { ethers, BrowserProvider } from "ethers";

declare global {
    interface Window {
        ethereum?: any;
    }
}

const INTENT_VAULT_ADDRESS = "0x..."; // Deploy address on Base Sepolia
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // USDC on Base Sepolia

const INTENT_VAULT_ABI = [
    "function createOrder(address _inputToken, uint256 _amount, bytes32 _recipientSui, uint256 _minOutputAmount, uint256 _deadline) external returns (bytes32 orderId)",
    "event OrderCreated(bytes32 indexed orderId, address indexed depositor, address inputToken, uint256 amount, bytes32 recipientSui)",
];

const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
];

export interface ManualOrder {
    orderId: string;
    status: "PENDING_APPROVAL" | "APPROVED" | "ORDER_CREATED" | "WAITING_SOLVER" | "SETTLED";
    txHash?: string;
}

export function useManualBridge() {
    const [loading, setLoading] = useState(false);
    const [order, setOrder] = useState<ManualOrder | null>(null);
    const [error, setError] = useState<string | null>(null);

    const createOrder = useCallback(async (params: {
        amount: string;
        recipientSui: string;
        minOutputAmount: string;
        deadlineMinutes: number;
    }) => {
        setLoading(true);
        setError(null);

        try {
            if (!window.ethereum) {
                throw new Error("Please install MetaMask");
            }

            const provider = new BrowserProvider(window.ethereum);
            await provider.send("eth_requestAccounts", []);
            const signer = await provider.getSigner();

            // Convert amount to wei (USDC has 6 decimals)
            const amountWei = ethers.parseUnits(params.amount, 6);
            const minOutputWei = ethers.parseUnits(params.minOutputAmount, 9); // SUI has 9 decimals
            const deadline = Math.floor(Date.now() / 1000) + (params.deadlineMinutes * 60);

            // Convert SUI address to bytes32
            const recipientBytes32 = ethers.zeroPadValue(params.recipientSui, 32);

            // Step 1: Approve USDC
            setOrder({ orderId: "", status: "PENDING_APPROVAL" });
            const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
            const approveTx = await usdc.approve(INTENT_VAULT_ADDRESS, amountWei);
            await approveTx.wait();

            setOrder({ orderId: "", status: "APPROVED" });

            // Step 2: Create Order
            const vault = new ethers.Contract(INTENT_VAULT_ADDRESS, INTENT_VAULT_ABI, signer);
            const tx = await vault.createOrder(
                USDC_ADDRESS,
                amountWei,
                recipientBytes32,
                minOutputWei,
                deadline
            );

            const receipt = await tx.wait();

            // Parse OrderCreated event
            const iface = new ethers.Interface(INTENT_VAULT_ABI);
            const log = receipt.logs.find((l: any) => {
                try {
                    iface.parseLog(l);
                    return true;
                } catch {
                    return false;
                }
            });

            if (log) {
                const parsed = iface.parseLog(log);
                setOrder({
                    orderId: parsed?.args.orderId,
                    status: "ORDER_CREATED",
                    txHash: receipt.hash,
                });
            }
        } catch (err: any) {
            setError(err.message || "Failed to create order");
        } finally {
            setLoading(false);
        }
    }, []);

    return {
        loading,
        order,
        error,
        createOrder,
    };
}
