# PrivaMargin

Privacy-preserving collateral management on Canton + EVM.

## Overview

PrivaMargin enables funds to pledge collateral against trading positions with prime brokers, using Canton/Daml for auditable business logic and EVM smart contracts for on-chain custody. Margin verification, position management, and liquidation are coordinated across both ledger layers.

## Architecture

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Business Logic | Canton / Daml | Vaults, positions, roles, margin calls, broker-fund links |
| On-chain Custody | Solidity (VaultEscrow) | Per-vault escrow holding ETH/ERC20 on EVM chains |
| Privacy Pool | Solidity (DepositRelay) | Shared deposit pool that breaks depositor-escrow traceability |
| Wallet / Signing | Stratos SDK | Key management, EVM transactions, Canton contract operations |
| Frontend | React + MUI | Operator, broker, and fund dashboards |
| API / Config | Cloudflare Pages Functions + KV | Config persistence (operator party, relay addresses, platform assets) |

## Roles

- **Operator** — Platform administrator. Creates role assignments, deploys escrow/relay contracts, configures platform assets.
- **PrimeBroker** — Issues invitations to funds, sets LTV thresholds, manages positions, triggers margin calls and liquidations.
- **Fund** — Creates vaults, deposits collateral, accepts broker invitations, opens positions.

## Lifecycle

1. **Setup** — Operator creates `OperatorRole` contract on Canton.
2. **Role Assignment** — Operator assigns PrimeBroker and Fund roles via `AssignPrimeBroker` / `AssignFund`.
3. **Invitations** — Broker sends `BrokerFundInvitation` to fund; fund accepts to create `BrokerFundLink`.
4. **Vault Creation** — Fund creates a `CollateralVault` on Canton.
5. **Escrow Deployment** — Fund deploys a `VaultEscrow` contract on an EVM chain, registered on the vault.
6. **Deposits** — Fund deposits ETH/ERC20 into the escrow (or via DepositRelay for privacy). Deposit recorded on Canton with tx hash.
7. **Positions** — Fund opens positions referencing a vault. LTV is calculated from live collateral value vs notional.
8. **Margin Verification** — Broker monitors LTV against threshold. If breached, a `WorkflowMarginCall` is created.
9. **Liquidation** — If LTV exceeds threshold, broker liquidates: escrow wraps ETH to WETH, swaps to USDC via Uniswap V3, sends to broker. Canton position updated to `Liquidated`.

## EVM Escrow System

### VaultEscrow (per-vault custody)

Each vault gets its own `VaultEscrow` contract on an EVM chain. The deployer is the immutable owner; a separate liquidator address is set at deployment.

- **Deposits**: Native ETH via `receive()`, ERC20 via direct transfer
- **Withdrawals**: Owner calls `withdrawETH` / `withdrawERC20`
- **Liquidation**: Liquidator calls `liquidate` — wraps ETH to WETH, swaps to USDC via Uniswap V3 `exactInputSingle`, sends USDC to broker

### DepositRelay (privacy pool)

One `DepositRelay` per chain. Funds deposit into the shared pool; the operator forwards batched amounts to individual escrows. Events intentionally omit `msg.sender` to break on-chain traceability.

- `depositERC20(token, amount)` — Fund deposits ERC20
- `receive()` — Fund deposits ETH
- `forwardETH(to, amount)` — Operator forwards to escrow
- `forwardERC20(token, to, amount)` — Operator forwards ERC20 to escrow

Deposit routing: if a relay is deployed for the target chain, deposits go to the relay; otherwise they fall back to direct escrow transfer.

## Network Configuration

Set `VITE_NETWORK_MODE` to switch between testnet and mainnet:

| Mode | Default Chain | Available Chains |
|------|--------------|------------------|
| `testnet` (default) | Sepolia (11155111) | Sepolia |
| `mainnet` | Ethereum (1) | Ethereum, Base |

```bash
# .env
VITE_NETWORK_MODE=testnet   # or mainnet
```

## Supported Chains

| Chain | ID | SwapRouter | WETH | USDC |
|-------|-----|-----------|------|------|
| Ethereum | 1 | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Sepolia | 11155111 | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Base | 8453 | `0x2626664c2603336E57B271c5C0b26F421741e481` | `0x4200000000000000000000000000000000000006` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

Relay addresses are stored in Cloudflare KV at runtime (key: `relay_<chainId>`).

## Development

### Prerequisites

- Node.js 18+
- Daml SDK (for building the DAR package)
- Stratos Wallet SDK (local package)

### Build

```bash
npm install
npm run build:dar      # Compile Daml contracts
npm run copy-dar       # Copy DAR to public/
npm run build          # TypeScript + Vite production build
```

### Compile Solidity Contracts

```bash
npx solcjs --bin --abi --optimize contracts/VaultEscrow.sol -o contracts/build/
npx solcjs --bin --abi --optimize contracts/DepositRelay.sol -o contracts/build/
```

### Development Server

```bash
npm run dev
```

### Deploy

```bash
npm run deploy         # Deploy to Cloudflare Pages
```

### Type Check

```bash
npm run lint
```
