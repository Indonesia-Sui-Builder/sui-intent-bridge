# Cross-Chain Intent Bridge MVP

A dual-mode cross-chain bridging solution for **SUI ↔ EVM** with two experimental approaches.

## 🚀 Features

- **1Click Mode**: Instant bridging via NEAR Intents solver network (~30s)
- **Manual Mode**: Custom Wormhole-based bridging with IntentVault contracts (15-20 min)
- **Premium UI**: Glassmorphism, animations, dark mode
- **CLI Examples**: Step-by-step NEAR Intents integration scripts

## 📁 Structure

```
├── apps/frontend/      # Next.js 15 frontend (dual mode)
├── contracts/evm/      # IntentVault.sol (Manual mode)
├── contracts/sui/      # solver.move (Manual mode)
├── 1click-example/     # NEAR Intents CLI scripts
└── scripts/            # Solver bot for Manual mode
```

## 🏃 Quick Start

### Frontend
```bash
cd apps/frontend
npm install
npm run dev
```

### 1Click Examples
```bash
cd 1click-example
npm install
npm run getTokens   # List supported tokens
npm run getQuote    # Get swap quote
npm run fullSwap    # Execute complete flow
```

## 🔧 Configuration

### Environment Variables

Create `.env` in `1click-example/`:
```
ONE_CLICK_JWT=your_jwt_token
SUI_PRIVATE_KEY=your_sui_private_key
```

Create `.env` in `contracts/evm/`:
```
RPC_URL=https://sepolia.base.org
PRIVATE_KEY=your_evm_private_key
```

## 📚 Modes

| Mode | Technology | Speed | Best For |
|------|------------|-------|----------|
| 1Click | NEAR Intents | ~30s | Production UX |
| Manual | Wormhole VAA | 15-20min | Technical demo |

## 🛠️ Tech Stack

- **Frontend**: Next.js 15, Tailwind CSS, Framer Motion
- **1Click**: NEAR Intents API, @defuse-protocol/one-click-sdk-typescript
- **Manual**: Solidity (IntentVault), Move (solver), Wormhole SDK

## 📖 Resources

- [NEAR Intents Docs](https://docs.near-intents.org)
- [Wormhole SDK](https://wormhole.com/docs)
- [1Click SDK](https://github.com/defuse-protocol/one-click-sdk-typescript)
