# Bidirectional Cross-Chain Intent Bridge (Sui ↔ EVM) 🚀

This repository implements a fully functional, bidirectional cross-chain intent bridge between **Sui (Move)** and **EVM (Solidity)**, powered by **Wormhole** for global settlement and featuring a **Dutch Auction** mechanism for optimal price discovery.

## 🌟 Key Features

- **Bidirectional**: Move koin seamlessly between Sui Testnet and Base Sepolia (EVM).
- **Intent-Based Architecture**: Users lock funds on the source chain with a "intent", and solvers fulfill them on the target chain immediately.
- **Dutch Auction**: Order prices decay linearly over time, ensuring orders are filled by the most efficient solver.
- **Modular Solvers**: Dedicated bots for each direction with automatic profitability checking and VAA fetching.
- **Fast Execution**: Solvers provide immediate liquidity, while settlement happens asynchronously via Wormhole.

---

## 🏗️ Architecture

1.  **Intent Creation**: User locks funds in a contract (Sui or EVM) and defines a Dutch Auction (start price, floor price, duration).
2.  **Solver Detection**: Bot monitors events on the source chain and calculates the current required output based on the auction timer.
3.  **Fulfillment**: If profitable, the bot sends the required funds directly to the user's recipient address on the target chain.
4.  **Global Settlement**: The bot fetches a signed VAA from Wormhole as proof of payment and uses it to claim the user's locked funds on the source chain.

---

## 📁 Project Structure

```bash
├── contracts/
│   ├── sui/            # Move contracts (intent, solver_engine)
│   └── evm/            # Solidity contracts (IntentVault)
├── scripts/
│   ├── solvers/        # The Brain 🧠: Modular bot logic
│   │   ├── utils.ts             # Shared math, clients, and VAA logic
│   │   ├── solver_evm_to_sui.ts # Bot for Direction A
│   │   └── solver_sui_to_evm.ts # Bot for Direction B
│   ├── create-intent.ts         # Script to test Sui -> EVM
│   ├── create-order.ts          # Script to test EVM -> Sui
│   └── deploy-...               # Deployment and configuration scripts
└── README.md
```

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v18+)
- Bun (optional, but recommended)
- Sui CLI & Foundry (for contract modifications)

### 2. Installation
```bash
npm install
# or
bun install
```

### 3. Configuration
Create a `.env` file in the root based on the provided examples:
```env
PRIVATE_KEY_EVM=...
PRIVATE_KEY_SUI=...

# Contract IDs (after deployment)
SUI_PACKAGE_ID=...
EVM_INTENT_BRIDGE_ADDRESS=...
SOLVER_STATE_ID=...
```

### 4. Running the Solvers

Open two terminals to run both directions:

**Terminal 1: EVM ➡️ Sui**
```bash
npx ts-node scripts/solvers/solver_evm_to_sui.ts
```

**Terminal 2: Sui ➡️ EVM**
```bash
npx ts-node scripts/solvers/solver_sui_to_evm.ts
```

---

## 🧪 Testing the Bridge

### From EVM to Sui
1. Update `scripts/create-order.ts` with your desired recipient.
2. Run: `npx ts-node scripts/create-order.ts`
3. Watch the EVM ➡️ Sui solver pick it up and complete the flow!

### From Sui to EVM
1. Update `scripts/create-intent.ts` with your recipient address.
2. Run: `npx ts-node scripts/create-intent.ts`
3. Watch the Sui ➡️ EVM solver detect the intent and send you ETH on Base Sepolia!

---

## 🛠️ Tech Stack
- **Sui**: Move Lang, @mysten/sui SDK
- **EVM**: Solidity, Viem, Ethers.js
- **Bridge**: Wormhole SDK (Guardians/VAA)
- **Environment**: Base Sepolia & Sui Testnet

---

## 📖 Verified Transactions (Demos)
- **EVM ➡️ Sui Solve**: [73BE5fzs...](https://testnet.suivision.xyz/txblock/73BE5fzs7KyJCMBvCZLpKaTyPpAdFV4E3snuyixroSyp)
- **Sui ➡️ EVM Fulfill**: [0xcd0bc6ed...](https://sepolia.basescan.org/tx/0xcd0bc6ed0cfcec54554d8f45cf460814a4570f70e8f27718b3762ebf8060706c)
