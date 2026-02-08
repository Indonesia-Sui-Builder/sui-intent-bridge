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

1.  **Intent Creation**: User locks funds in a contract (Sui or EVM (Base Sepolia)) and defines a Dutch Auction (start price, floor price, duration).
2.  **Solver Detection**: Bot monitors events on the source chain and calculates the current required output based on the auction timer.
3.  **Fulfillment**: If profitable, the bot sends the required funds directly to the user's recipient address on the target chain.
---

## 📖 Workflow & Usage Guide

### 1. Direction: Sui ➡️ EVM (Base Sepolia)

**Goal**: Transfer SUI from Sui Testnet to ETH on Base Sepolia.

1.  **User Action**:
    *   Open the Frontend or use the script `scripts/create-intent.ts`.
    *   Connect Sui Wallet and Base Wallet.
    *   Enter amount of SUI to swap.
    *   Click "Swap" / "Create Intent".
    *   *Result*: Funds are locked in the `Intent` contract on Sui.

2.  **Solver Action** (Automated):
    *   The `solver_sui_to_evm.ts` script detects the `IntentCreated` event on Sui.
    *   It verifies the profitability.
    *   It sends ETH to your recipient address on Base Sepolia.
    *   *Result*: You receive ETH on Base Sepolia immediately.

3.  **Settlement** (Automated):
    *   The solver waits for the Wormhole VAA (proof of transaction).
    *   It uses this VAA to claim the locked SUI on the Sui network as reimbursement + profit.

### 2. Direction: EVM (Base Sepolia) ➡️ Sui

**Goal**: Transfer USDC from Base Sepolia to SUI on Sui Testnet.

1.  **User Action**:
    *   Open the Frontend or use the script `scripts/create-order.ts`.
    *   Connect Base Wallet (EVM).
    *   Approve USDC usage.
    *   Click "Create Order".
    *   *Result*: USDC is locked in the `IntentVault` on Base Sepolia.

2.  **Solver Action** (Automated):
    *   The `solver_evm_to_sui.ts` script detects the `OrderCreated` event on Base Sepolia.
    *   It calculates the required SUI amount based on the Dutch Auction logic.
    *   It sends SUI to your recipient address on Sui Testnet.
    *   *Result*: You receive SUI on Sui Testnet immediately.

3.  **Settlement** (Automated):
    *   The solver waits for the Wormhole VAA.
    *   It uses this VAA to claim the locked USDC on Base Sepolia.

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
│   ├── create-intent.ts         # Script to test Sui -> EVM (Base Sepolia)
│   ├── create-order.ts          # Script to test EVM (Base Sepolia) -> Sui
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

### 4. Running the Full Stack

To run the complete system, you will need **3 separate terminal windows**.

**Terminal 1: Run the EVM ➡️ Sui Solver**
This bot listens for orders on Base Sepolia and fulfills them on Sui Testnet.
```bash
npx ts-node scripts/solvers/solver_evm_to_sui.ts
```

**Terminal 2: Run the Sui ➡️ EVM Solver**
This bot listens for intents on Sui Testnet and fulfills them on Base Sepolia.
```bash
npx ts-node scripts/solvers/solver_sui_to_evm.ts
```

**Terminal 3: Run the Frontend**
Launch the user interface to interact with the bridge.
```bash
cd frontend
bun run dev
# Open http://localhost:3000 in your browser
```

---

## 🧪 Testing the Bridge

### From EVM to Sui (Walkthrough)

1.  **Start Solvers**: Ensure Terminal 1 is running.
2.  **Open Frontend**: Go to `http://localhost:3000`.
3.  **Connect Wallet**: Connect your EVM wallet (Base Sepolia).
4.  **Create Order**:
    *   Select "USDC" as input.
    *   Enter amount (e.g., `0.1`).
    *   Click "Approve USDC" -> "Create Order".
5.  **Watch Terminal 1**: You will see the solver detect the order (`New Order Detected!`), calculate profit, and then execute the swap on Sui (`Executing Order on Sui...`).
6.  **Receive Funds**: Check your Sui wallet. You will receive SUI immediately.

### From Sui to EVM (Walkthrough)

1.  **Start Solvers**: Ensure Terminal 2 is running.
2.  **Open Frontend**: Go to `http://localhost:3000`.
3.  **Connect Wallet**: Connect your Sui wallet (Testnet).
4.  **Create Intent**:
    *   Select "SUI" as input.
    *   Enter amount.
    *   Click "Swap".
5.  **Watch Terminal 2**: The solver will detect the intent and send ETH to your Base Sepolia address.

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

# Note
This smart contract will be changed following the official documentation of Wormhole and Move Book.
