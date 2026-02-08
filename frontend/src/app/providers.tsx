'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import {
    createNetworkConfig,
    SuiClientProvider,
    WalletProvider,
} from '@mysten/dapp-kit';
import '@mysten/dapp-kit/dist/index.css';

const queryClient = new QueryClient();

const wagmiConfig = createConfig({
    chains: [baseSepolia],
    transports: {
        [baseSepolia.id]: http(),
    },
});

// Use getFullnodeUrl from the correct path. If for some reason it's not available or
// specific URLs are preferred, they can be hardcoded here.
// The common Sui networks are 'mainnet', 'testnet', 'devnet', and 'localnet'.
// We'll ensure these are correctly configured.
const { networkConfig } = createNetworkConfig({
    mainnet: { url: 'https://fullnode.mainnet.sui.io', network: 'mainnet' },
    testnet: { url: 'https://fullnode.testnet.sui.io', network: 'testnet' },
    devnet: { url: 'https://fullnode.devnet.sui.io', network: 'devnet' },
    localnet: { url: 'http://127.0.0.1:9000', network: 'localnet' },
});

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                {/* Set defaultNetwork to 'devnet' or 'testnet' based on your primary development/testing environment */}
                <SuiClientProvider networks={networkConfig} defaultNetwork="devnet">
                    <WalletProvider>
                        {children}
                    </WalletProvider>
                </SuiClientProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
