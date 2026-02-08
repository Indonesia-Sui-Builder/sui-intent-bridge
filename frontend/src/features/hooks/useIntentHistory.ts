
import { useState, useEffect, useCallback } from 'react';

export type IntentStatus = 'PENDING' | 'SETTLED' | 'EXPIRED' | 'FAILED'; // Added FAILED for safety

export interface IntentTransaction {
    id: string; // UUID for local tracking
    orderId: string; // Chain ID (EVM orderId or Sui intentId)
    type: 'EVM_TO_SUI' | 'SUI_TO_EVM'; // Preserving direction context
    inputToken: string;
    outputToken: string;
    inputAmount: string;
    expectedOutput: string;
    recipient: string; // Preserving recipient context
    txHash: string;
    destTxHash?: string; // Hash of the fulfillment transaction on the destination chain
    status: IntentStatus;
    timestamp: number;
}

const STORAGE_KEY = 'intent-history'; // Updated key as per requirements
const EVENT_KEY = 'naisu-history-update';

export function useIntentHistory() {
    const [transactions, setTransactions] = useState<IntentTransaction[]>([]);

    const loadFromStorage = useCallback(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                setTransactions(JSON.parse(stored));
            }
        } catch (e) {
            console.error("Failed to load intent history:", e);
        }
    }, []);

    // Load on mount and listen for updates
    useEffect(() => {
        loadFromStorage();

        const handleStorageChange = () => {
            loadFromStorage();
        };

        window.addEventListener(EVENT_KEY, handleStorageChange);
        return () => window.removeEventListener(EVENT_KEY, handleStorageChange);
    }, [loadFromStorage]);

    const notifyListeners = () => {
        window.dispatchEvent(new Event(EVENT_KEY));
    };

    const save = (newTransactions: IntentTransaction[]) => {
        setTransactions(newTransactions);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newTransactions));
        notifyListeners();
    };

    const addTransaction = useCallback((tx: IntentTransaction) => {
        setTransactions(prev => {
            // Prevent duplicates based on local UUID or chain ID
            if (prev.some(t => t.id === tx.id || t.orderId === tx.orderId)) return prev;

            const updated = [tx, ...prev];
            save(updated); // Use the save helper
            return updated;
        });
    }, [save]);

    const updateTransactionStatus = useCallback((orderId: string, status: IntentStatus, destTxHash?: string) => {
        setTransactions(prev => {
            const updated = prev.map(tx =>
                tx.orderId === orderId ? { ...tx, status, destTxHash: destTxHash || tx.destTxHash } : tx
            );
            save(updated); // Use the save helper
            return updated;
        });
    }, [save]);

    // Explicit removal if needed
    const removeTransaction = useCallback((id: string) => {
        setTransactions(prev => {
            const updated = prev.filter(tx => tx.id !== id);
            save(updated); // Use the save helper
            return updated;
        });
    }, [save]);

    const clearHistory = useCallback(() => {
        setTransactions([]);
        localStorage.removeItem(STORAGE_KEY);
        notifyListeners(); // Notify others that history is cleared
    }, [notifyListeners]);

    return {
        transactions,
        addTransaction,
        updateTransactionStatus,
        removeTransaction,
        clearHistory
    };
}
