# PrivaMargin

Privacy-preserving prime brokerage margin management on Canton Network.

PrivaMargin enables hedge funds to prove margin sufficiency to prime brokers using zero-knowledge proofs — brokers verify collateral adequacy without seeing individual asset values. Collateral lives in self-custodied EVM escrow contracts and Canton-native vaults, with proportional liquidation that seizes only what's owed.

### Demo

[![PrivaMargin Demo](https://img.youtube.com/vi/ex3KanbFG1s/maxresdefault.jpg)](https://youtu.be/ex3KanbFG1s)

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Role Hierarchy](#role-hierarchy)
- [Daml Smart Contracts](#daml-smart-contracts)
- [EVM Contracts](#evm-contracts)
- [Zero-Knowledge Proof System](#zero-knowledge-proof-system)
- [Collateral Vaults](#collateral-vaults)
- [Position Lifecycle](#position-lifecycle)
- [Liquidation Workflow](#liquidation-workflow)
- [Broker-Fund Relationships](#broker-fund-relationships)
- [Margin Verification](#margin-verification)
- [LTV Monitor Workflow](#ltv-monitor-workflow)
- [Auto-Liquidate Preference](#auto-liquidate-preference)
- [API Layer](#api-layer)
- [Cloudflare Pages Functions](#cloudflare-pages-functions)
- [Frontend Pages](#frontend-pages)
- [Chain Support](#chain-support)
- [Build & Deploy](#build--deploy)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                        │
│  Dashboard · Vaults · Positions · Brokers · Admin        │
├──────────────┬──────────────────────┬───────────────────┤
│  api.ts      │  evmEscrow.ts        │  zkProof.ts       │
│  (Canton SDK │  (ABI encoding,      │  (Groth16 proof   │
│   + service  │   chain config,      │   generation &    │
│   layer)     │   contract deploy)   │   verification)   │
├──────────────┴──────────────────────┴───────────────────┤
│              Cloudflare Pages Functions                   │
│  /api/config · /api/prices · /api/escrow/deploy          │
│  /api/escrow/balances · /api/custodian/*  · /api/roles   │
│  /api/auto-liquidate                                      │
├──────────────────────────────────────────────────────────┤
│              Cloudflare Workflow Worker                    │
│  LTV Monitor (cron: every min, KV-gated interval)         │
│  Reads: Canton positions/vaults/links + KV auto-liq prefs │
│  Writes: margin calls, position updates, auto-liquidation │
├─────────────────────────┬───────────────────────────────┤
│     Canton Network      │        EVM Chains              │
│  (Daml ledger)          │  (Ethereum, Base)              │
│                         │                                │
│  Vaults · Positions     │  VaultEscrow.sol               │
│  Roles · Links          │  (per-vault, self-custodied)   │
│  Assets · Locks         │                                │
│  Margin Verification    │  Uniswap V3 (ETH→USDC swap)   │
└─────────────────────────┴───────────────────────────────┘
```

**Dual ledger model**: Canton (Daml) is the source of truth for contract state — vaults, positions, roles, and broker-fund links. EVM chains hold actual crypto collateral in per-vault escrow contracts. The two are synchronized via the API layer.

**Privacy model**: Funds' actual collateral values are hidden from brokers. Brokers only see ZK-verified sufficiency status ("Sufficient" or "Insufficient"). The ZK circuit proves LTV correctness without revealing individual asset values.

---

## Role Hierarchy

Three roles form a hierarchy managed on the Canton ledger:

| Role | Description | Assigned By |
|------|-------------|-------------|
| **Operator** | System administrator. Manages platform configuration, provisions custodian, assigns roles. | Self (first user claims) |
| **Prime Broker** | Manages fund relationships, monitors margin, triggers liquidations. | Operator |
| **Fund** | Manages collateral vaults, opens/closes positions, responds to margin calls. | Operator or Prime Broker |

Roles are recorded as `RoleAssignment` contracts on Canton. The operator creates an `OperatorRole` contract at system initialization, then uses `AssignPrimeBroker` and `AssignFund` choices to grant roles. Brokers can also assign fund roles via `BrokerRole.BrokerAssignFund`.

---

## Daml Smart Contracts

All contracts are defined in `daml/src/` and compiled to a DAR package (`daml/.daml/dist/privamargin6-0.1.0.dar`). SDK version: 3.4.9, target: Canton 2.1.

### `Roles.daml` — Role Management

```
OperatorRole (signatory: operator)
  ├── AssignPrimeBroker(broker) → RoleAssignment
  └── AssignFund(fund)          → RoleAssignment

BrokerRole (signatory: operator, broker)
  └── BrokerAssignFund(fund)    → RoleAssignment

RoleAssignment (signatory: operator; observer: party)
  └── RevokeRole()
```

### `BrokerFundLink.daml` — Broker-Fund Relationships

```
BrokerFundInvitation (signatory: broker, operator; observer: fund)
  ├── AcceptInvitation() → BrokerFundLink
  └── RejectInvitation()

BrokerFundLink (signatory: broker, fund, operator)
  ├── SetLTVThreshold(newThreshold)
  ├── DeactivateLink()
  ├── UpdateAllowedAssets(newAllowedAssets)
  ├── UpdateAllowedCollaterals(newAllowedCollaterals)
  ├── GetLTVThreshold() → Decimal           [nonconsuming]
  └── ProposeLTVChange(...) → LTVChangeProposal  [nonconsuming]

LTVChangeProposal (signatory: broker, operator; observer: fund)
  ├── AcceptProposal() → BrokerFundLink (with new threshold)
  └── RejectProposal() (deactivates link)
```

Each link stores configurable `ltvThreshold` (default 0.8 = 80%), `allowedAssets` (tradeable symbols), and `allowedCollaterals` (depositable symbols). Default allowed symbols: BTC, ETH, SOL, CC, USDC, USDT, TRX, TON, CUSD.

### `CollateralVault.daml` — Vault Management

```
CollateralVault (signatory: owner; observer: operator)
  Fields:
    vaultId, owner, operator, collateralAssets: [AssetPosition],
    totalValue, linkedPositions, chainVaults: [{chain, custodyAddress}],
    depositRecords: [{txId, chain, symbol, amount}], createdAt

  Choices:
    ├── DepositAsset(assetCid)          — adds TokenizedAsset to vault
    ├── DepositAssetWithTx(assetCid, txId, chain, symbol, amount)
    ├── WithdrawAsset(assetId)          — removes asset by ID (all-or-nothing)
    ├── RegisterChainVault(chain, addr) — links an EVM escrow address
    ├── RecordDeposit(txId, chain, symbol, amount)
    ├── GetVaultInfo()                  — returns (totalValue, assetCount) [nonconsuming]
    └── CloseVault()                    — archives the contract

AssetPosition = { assetId, assetType, amount, valueUSD }
```

**Key constraint**: `WithdrawAsset` removes an entire `AssetPosition` by `assetId` — there is no partial withdrawal parameter. This is handled during liquidation by withdrawing the full entry, transferring the needed portion, and re-depositing the remainder.

### `Assets.daml` — Tokenized Assets

```
AssetIssuance (signatory: issuer; observer: recipient)
  └── Accept() → TokenizedAsset

TokenizedAsset (signatory: issuer, owner)
  ├── Transfer(newOwner) → TokenizedAsset
  └── UpdateValue(newValueUSD) → TokenizedAsset
```

Asset types: `CantonCoin | Stablecoin | Cryptocurrency | RWA | Bond | Equity`

The `AssetIssuance → Accept` pattern is used throughout for minting: the issuer creates an issuance, the recipient accepts it, producing a `TokenizedAsset` that can be deposited into a vault.

### `Position.daml` — Trading Positions

```
Position (signatory: fund; observer: broker, operator)
  Fields:
    positionId, vaultId, fund, broker, operator, description,
    notionalValue, collateralValue, currentLTV,
    status: Open | MarginCalled | Liquidated | Closed,
    direction: Optional (Long | Short),
    entryPrice, units, unrealizedPnL, closingPrice,
    zkCollateralProofHash: Optional Text,
    zkProofTimestamp: Optional Text,
    createdAt, lastChecked

  Choices:
    ├── UpdateLTV(newLTV, checkedAt, newPnL)                       [controller: operator]
    ├── MarkMarginCalled()                                          [controller: operator]
    ├── AttestCollateral(proofHash, attestedAt)                     [controller: fund]
    ├── ClosePosition(finalPnL, exitPrice)                          [controller: fund]
    └── LiquidatePosition(ltvThreshold, liquidatedAmount, ...)      [controller: operator]
```

`AttestCollateral` allows the fund to record a ZK proof hash and timestamp on-ledger, attesting to collateral sufficiency. The proof itself is stored off-ledger in KV; only the hash is on-chain. `UpdateLTV` (operator) preserves ZK fields via Daml's `this with` semantics — operator LTV updates never overwrite the fund's attestation.

`LiquidatePosition` enforces two assertions:
1. `currentLTV >= ltvThreshold` — position must actually be underwater
2. `status == Open || status == MarginCalled` — can't liquidate already closed/liquidated positions

### `CollateralLock.daml` — Self-Custody Pledges

```
CollateralLock (signatory: owner; observer: operator)
  Fields: owner, operator, vaultId, assetType, symbol, amount, valueUSD, lockId

  Choices:
    ├── Unlock()                          [controller: owner]
    ├── ForceLiquidate(reason)            [controller: operator]
    └── UpdateLockValue(newValueUSD)      [controller: operator]
```

Represents an encumbrance — the owner pledges Canton Coin (CC) as collateral without physically transferring it. The lock records the commitment; actual transfer only happens during liquidation.

### `MarginVerification.daml` — Margin Calls & Settlement

```
MarginRequirement (signatory: provider, counterparty, operator)
  ├── VerifyMargin(vaultCid, currentTime) → updated status (Sufficient/Insufficient)
  └── TriggerMarginCall()                 → MarginCall

MarginCall (signatory: provider, counterparty, operator)
  ├── SettleMarginCall(vaultCid, settledAssets, settlementTime) → Settlement
  └── CancelMarginCall()

WorkflowMarginCall (signatory: operator; observer: fund, broker)
  ├── AcknowledgeMarginCall()  [controller: fund]
  ├── ResolveMarginCall()      [controller: operator]
  └── CancelWorkflowMarginCall()

Status flow: WMCActive → WMCAcknowledged → WMCResolved
```

`WorkflowMarginCall` is the practical margin call template used in the application — it tracks the fund acknowledgement workflow.

---

## EVM Contracts

### `VaultEscrow.sol`

Per-vault self-custody escrow contract deployed on EVM chains. Each vault gets its own escrow per chain.

```solidity
constructor(address _owner, address _liquidator,
            address _swapRouter, address _weth, address _stablecoin)
```

| Function | Access | Description |
|----------|--------|-------------|
| `withdrawETH(to, amount)` | `onlyOwner` | Withdraw native ETH to specified address |
| `withdrawERC20(token, to, amount)` | `onlyOwner` | Withdraw ERC20 tokens to specified address |
| `liquidate(to, amount, amountOutMinimum)` | `onlyLiquidator` | Wrap ETH→WETH, swap via Uniswap V3 (0.3% pool fee) to USDC, send to broker |
| `liquidateERC20(token, to, amount)` | `onlyLiquidator` | Direct ERC20 transfer to broker |
| `getBalance()` | `view` | Returns contract's ETH balance |
| `receive()` | external | Accepts native ETH deposits |

**Key design**: The fund is the `owner` (can withdraw anytime), the operator/platform is the `liquidator` (can only liquidate, not withdraw). This preserves self-custody while enabling automated liquidation.

**ETH liquidation path**:
1. Wraps the specified ETH amount to WETH via `deposit()`
2. Approves Uniswap V3 SwapRouter for the WETH amount
3. Calls `exactInputSingle` on Uniswap V3 (WETH→USDC, 0.3% pool fee, 0 sqrtPriceLimitX96)
4. Sends resulting USDC to the broker's address
5. Remaining ETH stays in escrow untouched

**USDC liquidation path**:
1. Direct `transfer()` of the specified amount to the broker
2. No swap needed — USDC is already the settlement currency

All liquidation functions accept partial amounts — this is what enables proportional seizure.

---

## Zero-Knowledge Proof System

PrivaMargin uses Groth16 ZK-SNARKs to prove LTV ratio correctness without revealing individual asset values. The fund generates proofs in-browser; the broker verifies them without seeing the underlying data.

### Circuit: `circuits/ltv_verifier.circom`

```
Template: LTVVerifier(N=10)

Private inputs (fund's secret):
  assetValues[10]        — each asset's USD value in cents

Public inputs (known to both parties):
  notionalValueCents     — position notional in USD cents
  ltvThresholdBps        — liquidation threshold in basis points (e.g., 8000 = 80%)

Public outputs:
  computedLTVBps         — LTV ratio in basis points
  isLiquidatable         — 1 if LTV >= threshold, 0 otherwise
```

**How it works**:
1. Sums all 10 asset values → `totalCollateral`
2. Prover computes `LTV = floor(notionalValueCents × 10000 / totalCollateral)` off-circuit
3. Circuit verifies via cross-multiplication constraints (avoids division in the circuit):
   - `computedLTVBps × totalCollateral ≤ notionalValueCents × 10000` (lower bound)
   - `(computedLTVBps + 1) × totalCollateral > notionalValueCents × 10000` (upper bound)
4. Compares LTV against threshold using a `GreaterEqThan(16)` comparator
5. Zero collateral edge case: outputs `99999` (convention for max LTV)

Unused asset slots are padded with zeros. 64-bit comparison supports values up to ~$184 trillion in cents.

### Build Pipeline: `circuits/build.sh`

```bash
npm run build:zk
```

Five-step trusted setup process:
1. **Compile** — circom2 compiles the circuit → R1CS + WASM witness generator
2. **Powers of Tau** — Phase 1 ceremony (bn128 curve, 2^14 constraints) with random entropy
3. **Groth16 Setup** — Phase 2 circuit-specific setup with random entropy contribution
4. **Export** — Verification key exported as JSON
5. **Deploy** — Copies WASM, zkey, and verification key to `public/zk/`

### Runtime: `src/services/zkProof.ts`

| Function | Caller | Description |
|----------|--------|-------------|
| `generateLTVProof(input)` | Fund | Generates Groth16 proof in-browser using snarkjs WASM. Returns proof, public signals, computed LTV, liquidatability flag, and timing. |
| `verifyLTVProof(proof, publicSignals)` | Broker | Verifies a proof against the verification key. Returns boolean. |
| `proofHash(proof)` | Display | SHA-256 hex hash of proof for UI display. |
| `isZKAvailable()` | Startup | Checks if ZK artifacts are accessible (HEAD requests to `/zk/` files). |

Helper conversions:
- `usdToCents(usd)` — Converts dollar amount to integer cents
- `ltvToBps(decimal)` — Converts decimal LTV (e.g., 0.8) to basis points (8000)

Artifacts are served as static files from `public/zk/`:
- `ltv_verifier.wasm` — WASM witness generator
- `ltv_verifier_final.zkey` — Groth16 proving key
- `verification_key.json` — Groth16 verification key

### Live LTV ZK Integration

ZK proofs are automatically generated as part of the normal position flow — not just on the standalone Margin Verification page:

1. **Fund loads positions** → `recalcPositionsLive()` runs in `api.ts`
2. After LTV recalc, the fund generates one Groth16 proof per vault (attesting raw collateral sufficiency)
3. Proof is stored to KV via `POST /api/zkproof` (fire-and-forget) and hash is written on-ledger via `AttestCollateral`
4. Proofs are rate-limited to one per vault every 5 minutes (skips if existing proof is recent)
5. **Broker opens position detail** → sees ZK Attestation section → clicks "Verify Proof" → fetches full proof from KV → runs `verifyLTVProof()` in-browser

The ZK proof attests to raw collateral sufficiency (no PnL). PnL is public data derived from market prices and on-ledger fields.

| Component | Role | What happens |
|-----------|------|--------------|
| `api.ts` `recalcPositionsLive` | Fund | Generates proof, stores to KV, exercises `AttestCollateral` on-ledger |
| `functions/api/zkproof.ts` | Both | KV-backed storage: `POST` stores proof, `GET ?hash=` retrieves it |
| `Positions.tsx` detail dialog | Broker | Fetches proof from KV, verifies in-browser, shows Verified/Invalid chip |
| `Position.daml` `AttestCollateral` | Fund | Records `zkCollateralProofHash` + `zkProofTimestamp` on-ledger |

---

## Collateral Vaults

A vault is a logical container for a fund's collateral, spanning multiple asset types and chains.

### Vault Structure

```
CollateralVault (Canton/Daml)
  │
  ├── Canton-native assets (CC)
  │   ├── TokenizedAsset contracts on Daml
  │   └── CollateralLock (encumbrance record)
  │
  ├── EVM Escrow: Sepolia (VaultEscrow.sol)
  │   ├── Native ETH
  │   └── USDC (ERC20)
  │
  └── EVM Escrow: Base Sepolia (VaultEscrow.sol)
      ├── Native ETH
      └── USDC (ERC20)
```

A single vault can have escrows on multiple EVM chains simultaneously, plus Canton-native CC holdings. Each escrow is a separate `VaultEscrow.sol` deployment.

### Deposit Flow

**EVM assets (ETH, USDC)**:
1. Fund selects chain and asset from wallet
2. If no escrow exists for that chain → deploys `VaultEscrow` via `/api/escrow/deploy` (platform deployer pays gas)
3. Registers escrow address on Daml vault via `RegisterChainVault` choice
4. Transfers ETH/USDC from wallet to escrow contract address via SDK
5. Mints a corresponding `TokenizedAsset` on Daml and deposits into vault via `DepositAssetWithTx`
6. Records deposit transaction details (txId, chain, symbol, amount)

**Canton Coin (CC)**:
1. Fund initiates CC transfer to the vault custodian party via Splice wallet API
2. Custodian accepts the transfer offer (`/api/custodian/accept-deposit`)
3. Creates a `CollateralLock` on Daml (self-custody encumbrance — no physical transfer out of fund's control)
4. Mints `TokenizedAsset` and deposits into vault

### Withdrawal Flow

**EVM assets**: Fund calls `withdrawETH` or `withdrawERC20` on the VaultEscrow contract (owner-only). Also exercises `WithdrawAsset` on Daml to remove the asset entry.

**CC**: Custodian transfers CC back to the fund via `/api/custodian/withdraw`, then `WithdrawAsset` removes it from the Daml vault.

### Escrow Sync

`syncEscrowDeposits` detects external on-chain deposits (e.g., direct transfers to escrow address that bypassed the UI) by reading on-chain balances via `/api/escrow/balances` and comparing against tracked Daml assets. Untracked balances are minted as new `TokenizedAsset` entries and deposited into the vault.

### Live Price Revaluation

Every time a vault is queried, all asset values are recalculated using live prices from CoinGecko (60-second cache). This ensures LTV ratios reflect current market conditions. Fallback to hardcoded prices if CoinGecko is unavailable.

---

## Position Lifecycle

```
                    ┌──────────────────┐
                    │    Fund opens    │
                    │    position      │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
             ┌──── │      Open        │ ◄────┐
             │     └────────┬─────────┘      │
             │              │                 │
             │    LTV >= threshold            │  LTV recovers
             │              │                 │
             │              ▼                 │
             │     ┌──────────────────┐       │
             │     │  MarginCalled    │ ──────┘
             │     └────────┬─────────┘
             │              │
             │    Broker liquidates
             │              │
             │              ▼
             │     ┌──────────────────┐
             │     │   Liquidated     │
             │     └──────────────────┘
             │
             │  Fund closes
             │
             ▼
    ┌──────────────────┐
    │     Closed       │
    └──────────────────┘
```

### Opening a Position

1. Fund selects a linked broker from active `BrokerFundLink` contracts
2. Selects an asset from the link's `allowedAssets` list
3. Chooses direction (Long or Short) and number of units
4. Entry price is fetched live from CoinGecko
5. Notional value = units × entry price
6. Fund selects a vault — UI shows projected aggregate LTV after adding this position
7. Initial LTV is calculated from the vault's live collateral value
8. `Position` contract is created on Canton with status `Open`

### PnL Calculation (live, recalculated on every query)

```
For Long positions:
  unrealizedPnL = (currentPrice - entryPrice) × units

For Short positions:
  unrealizedPnL = (entryPrice - currentPrice) × units

Effective notional = notionalValue + unrealizedPnL
LTV = effectiveNotional / collateralValue
```

When PnL is negative (position is losing money), effective notional increases, pushing LTV higher toward the liquidation threshold.

### Closing a Position

Fund exercises `ClosePosition` choice. Status changes to `Closed`. No collateral movement — the fund retains everything in the vault.

---

## Liquidation Workflow

When a position's LTV exceeds the broker-fund link's threshold, the broker can trigger liquidation. The system seizes only enough collateral to cover the loss — **proportional seizure**, not full vault drain.

### Trigger Conditions

- `currentLTV >= ltvThreshold` (enforced by Daml `LiquidatePosition` assertion)
- Position status must be `Open` or `MarginCalled`
- Initiated by the broker (exercised via operator controller on Canton)

### Liquidation Amount

```
liquidationAmountUSD = |unrealizedPnL|, capped at vault's total collateral value
```

If PnL is zero or positive (fund is winning), no assets are seized — the position is simply marked `Liquidated` on Daml.

### Proportional Seizure Algorithm

**Phase 1 — Inventory** (read-only, no side effects):
```
For each EVM escrow chain linked to the vault:
  Read ETH balance via /api/escrow/balances
  Read USDC balance via /api/escrow/balances
  Fetch ETH live price from CoinGecko

Collect CC assets from vault's collateralAssets on Daml

Build sorted asset list:
  [{type, chain, balance, valueUSD, price, ...}]
  Sorted by seizure priority (USDC first, CC second, ETH last)
```

**Phase 2 — Plan** (pure computation, no side effects):
```
remainingDebt = liquidationAmountUSD

For each asset in priority order:
  seizeUSD  = min(asset.valueUSD, remainingDebt)
  seizeNative = convert seizeUSD to native units
  Record { asset, seizeNative, seizeUSD } in seizure plan
  remainingDebt -= seizeUSD
  if remainingDebt <= 0: stop
```

**Phase 3 — Execute** (only planned amounts are touched):
```
For each planned seizure with seizeNative > 0:
  USDC      → encodeLiquidateERC20(usdcAddr, brokerAddr, partialAmount)
  ETH       → encodeLiquidateETH(brokerAddr, partialWei, recalculatedAmountOutMin)
  USDC_CANTON → transfer USDCHolding from custodian to broker (/api/custodian/withdraw-usdc)
  CC/CUSDC  → swap CC value to USDC, transfer USDC to broker (/api/custodian/withdraw-usdc)
              fire-and-forget: replenish custodian USDC via /api/swap/cc-to-usdc
```

### Seizure Priority Order

| Priority | Asset | Rationale |
|----------|-------|-----------|
| 1 | **USDC** (all chains) | 1:1 USD value, no swap slippage |
| 2 | **CC** (Canton Coin) | Stable pricing via `getLivePrice('CC')` |
| 3 | **ETH** (all chains) | Volatile, incurs Uniswap V3 swap slippage |

### Per-Asset Seizure Details

**USDC**: `seizeWei = min(usdcBalance, BigInt(Math.floor(seizeUSD * 1e6)))` — USDC uses 6 decimals. Calls `liquidateERC20()` on the escrow contract. Remainder stays in escrow.

**ETH**: `seizeWei = min(ethBalance, BigInt(Math.floor(seizeUSD / ethPrice * 1e18)))` — Calls `liquidate()` on the escrow contract. `amountOutMin` is recalculated based on the partial USD value (not the full balance). The escrow wraps partial ETH to WETH, swaps via Uniswap V3, and sends USDC to broker. Remaining ETH stays in escrow.

**CC/CUSDC**: All CC-denominated collateral is settled in USDC. The seized CC value is converted to a USDC amount at the live CC/USD price, and the custodian transfers that USDC to the broker via Canton JSON API (`/api/custodian/withdraw-usdc`). The vault ledger is depleted via `SeizeCollateral`. After the broker receives USDC, a fire-and-forget call to `/api/swap/cc-to-usdc` replenishes the custodian's USDC reserves by swapping the CC with the bridge operator.

**USDC_CANTON**: Direct transfer of Canton USDCHolding from custodian to broker via `/api/custodian/withdraw-usdc` (Split + Transfer on the Daml contract).

### CC→USDC Swap (Custodian Replenishment)

After a liquidation involving CC collateral, the custodian's USDC reserves are depleted (USDC was sent to the broker). The `/api/swap/cc-to-usdc` endpoint replenishes the custodian by executing a same-chain Canton swap:

1. **Custodian → CC → Bridge Operator**: Creates a Splice TransferOffer from custodian to bridge operator, auto-accepts it
2. **Bridge Operator → USDC → Custodian**: Transfers equivalent USDCHolding from bridge operator to custodian via Canton JSON API

This runs fire-and-forget after the liquidation completes. If it fails, the broker still received their USDC — the only impact is the custodian's reserves aren't replenished until the next successful swap.

### What Arrives at the Broker

| Asset Seized | Broker Receives | Mechanism |
|-------------|----------------|-----------|
| USDC (EVM) | USDC (same amount) | Direct ERC20 transfer to broker's EVM address |
| ETH | USDC (swap output) | Uniswap V3 WETH→USDC swap, USDC sent to broker's EVM address |
| USDC (Canton) | USDC (same amount) | USDCHolding Transfer to broker's Canton party |
| CC/CUSDC | USDC (equivalent value) | CC value converted to USDC at live price, USDCHolding Transfer to broker |

### Liquidation Record

Every liquidation stores a `LiquidationRecord` with full audit trail:

```typescript
{
  positionId: string;
  liquidatedAt: string;
  liquidationAmountUSD: number;        // |PnL| = debt owed
  pnl: number;                         // unrealized PnL at liquidation
  collateralValueAtLiquidation: number; // vault value at time of liquidation
  ltvAtLiquidation: number;            // LTV when liquidation was triggered
  ltvThreshold: number;                // broker-fund link threshold

  escrowLiquidations: [{               // per-chain EVM seizures
    chain, custodyAddress,
    ethSeized, ethValueUSD,
    usdcSeized, txHashes[]
  }];

  ccSeized: [{                          // Canton Coin seizures
    symbol, amount, valueUSD
  }];

  brokerRecipient: string;             // broker's EVM address
}
```

Records are accessible via `positionAPI.getLiquidationRecord(positionId)` and displayed in the Position Detail Dialog.

---

## Settlement Status

### What Works

| Flow | Asset | Status | Mechanism |
|------|-------|--------|-----------|
| Liquidation | CC/CUSDC | **Working** | Vault ledger depleted via `SeizeCollateral`. Custodian sends USDC to broker (`withdraw-usdc`). Custodian replenished via `cc-to-usdc` swap (fire-and-forget). |
| Liquidation | USDC (Canton) | **Working** | Direct `USDCHolding` transfer from custodian to broker via Canton JSON API. |
| Liquidation | USDC (EVM) | **Partial** | Seized from escrow via `liquidateERC20`. Custodian fronts USDC to broker on Canton. **Gap**: EVM USDC lands at operator bridge address but is never bridged back to Canton — custodian not replenished. |
| Liquidation | ETH (EVM) | **Partial** | Seized from escrow, swapped to USDC via Uniswap V3. Custodian fronts USDC to broker on Canton. **Gap**: same as EVM USDC — swapped USDC sits at operator bridge address, custodian not replenished. |
| Normal close | All | **Not implemented** | `ClosePosition` only flips Daml status to `Closed`. No collateral return, no PnL settlement, no asset movement. |
| Margin call | All | **Not implemented** | `settleMarginCall` is a stub. |

### Seizure Priority (Mixed-Asset Vaults)

When a vault holds multiple asset types, liquidation seizes in this order:

| Priority | Asset | Rationale |
|----------|-------|-----------|
| 1 | USDC (Canton + EVM) | 1:1 value, no swap risk |
| 2 | CUSDC | Stable, Canton-native |
| 3 | CC | Requires CC→USDC swap |
| 4 | ETH | Volatile, Uniswap slippage |

The algorithm walks down the priority list, seizing only what's needed to cover `|PnL|`. If the first asset covers the debt, lower-priority assets are untouched. Partial seizures are supported within each asset.

### Open Questions — Settlement Design

**1. Normal close PnL settlement**

Not yet designed. When a position closes normally:
- **Fund wins** (positive PnL): broker owes fund. Where does the USDC come from? Broker reserves? A settlement pool? Post-trade netting?
- **Fund loses** (negative PnL): fund owes broker. Seize proportionally from vault (same as liquidation)? Or does the fund pay separately?
- **Collateral return**: after settlement, remaining vault collateral should be released back to the fund. No release mechanism exists.

**2. Settlement method — from-vault vs post-paid**

Two approaches, not yet decided:
- **From-vault (immediate)**: on close, seize the owed amount directly from vault collateral (mirrors liquidation). Simple but requires the vault to remain funded until close.
- **Post-paid (deferred)**: record the PnL on-ledger, settle separately via a netting/payment flow. More flexible but requires a settlement layer that doesn't exist yet.

For liquidation, settlement is currently from-vault (custodian fronts USDC, vault is depleted). Whether normal close should follow the same pattern is TBD.

**3. EVM bridge replenishment**

After EVM liquidation, seized USDC arrives at the operator's bridge EVM address. The custodian fronts equivalent USDC to the broker on Canton but is never replenished from the EVM side. Needs a bridge-back flow:
- Operator bridge EVM address → StratosSwap bridge → Canton USDC → custodian
- Or: operator periodically sweeps the bridge address and credits custodian off-chain

**4. Mixed-asset close settlement**

If a vault holds ETH + CC + USDC and the position closes with a loss:
- Does the seizure priority order apply (same as liquidation)?
- Can the fund choose which asset to settle with?
- What about partial vault release — if only some collateral is needed for settlement, how is the remainder returned?

**5. Multi-position vault settlement**

A single vault can back multiple positions. When one position closes:
- How much collateral is attributable to this position vs others?
- Can collateral be released if other positions are still open?
- Is settlement per-position or netted across all positions in the vault?

---

## Broker-Fund Relationships

### Link Lifecycle

```
Broker sends invitation
        │
        ▼
BrokerFundInvitation  ──► Fund accepts ──► BrokerFundLink (active)
        │                                        │
        ▼                                        ├── SetLTVThreshold
        Fund rejects                             ├── UpdateAllowedAssets
        (archived)                               ├── UpdateAllowedCollaterals
                                                 ├── ProposeLTVChange → LTVChangeProposal
                                                 │       ├── Fund accepts → updated threshold
                                                 │       └── Fund rejects → link deactivated
                                                 └── DeactivateLink
```

### Link Configuration

Each `BrokerFundLink` defines:
- **LTV Threshold** (default 0.8 = 80%) — positions exceeding this are eligible for liquidation
- **Allowed Assets** — symbols the fund can trade (e.g., BTC, ETH, SOL, CC, USDC)
- **Allowed Collaterals** — symbols the fund can deposit as collateral

**Auto-Liquidate** is a broker-side operational preference stored off-ledger in Cloudflare KV (not on the Daml contract). See [Auto-Liquidate Preference](#auto-liquidate-preference).

### LTV Threshold Changes

Brokers can propose threshold changes via `ProposeLTVChange`. This creates an `LTVChangeProposal` that the fund must accept or reject:
- **Accept**: Threshold is updated on the link. Existing positions continue with new threshold.
- **Reject**: The entire link is deactivated and all open positions between the pair are closed.

---

## Margin Verification

### LTV Calculation

```
LTV = Effective Notional Value / Total Collateral Value

Where:
  Effective Notional = Base Notional + Unrealized PnL
  Total Collateral   = Sum of all vault assets at live prices
```

LTV is recalculated on every query using live prices from CoinGecko (60-second cache, fallback to hardcoded prices).

**UI color coding**:
- **Green** (< 60%): Healthy
- **Amber** (60%–80%): Warning
- **Red** (≥ threshold): Critical / Liquidatable

### ZK-Verified Margin

ZK proofs are generated automatically during the fund's normal position flow (not just on the standalone Margin page):

1. Fund's asset values (private inputs) are converted to cents and padded to 10 slots
2. Proof is generated in-browser via snarkjs WASM (typically completes in seconds)
3. Public signals reveal only: computed LTV (basis points), liquidatability flag, notional value, threshold
4. Proof hash is written on-ledger via `AttestCollateral`; full proof stored in KV (`/api/zkproof`)
5. Broker verifies the proof using only the verification key — **never sees individual asset values**
6. Broker's position detail dialog shows a "Verify Proof" button that fetches and verifies in-browser

### What Each Party Sees

| Data Point | Fund | Broker |
|-----------|------|--------|
| Individual asset values | Yes | **No** (private ZK input) |
| Total collateral value | Yes | **No** |
| LTV ratio | Yes | Yes (ZK output) |
| Margin sufficiency | Yes | Yes ("Sufficient" / "Insufficient") |
| Position notional | Yes | Yes (public ZK input) |
| LTV threshold | Yes | Yes (public ZK input) |

---

## LTV Monitor Workflow

A Cloudflare Workflow Worker (`workflow/ltv-monitor.ts`) runs on a per-minute cron schedule with a KV-configurable check interval (default 15 minutes) to automatically monitor all open positions and take action when LTV thresholds are breached. The operator can change the check frequency from the dashboard UI without redeploying.

### Workflow Steps

```
Step 1: fetch-positions
  │  Query Canton for all Position contracts with status = "Open"
  │
Step 2: fetch-vault-values
  │  Query Canton for CollateralVault contracts for each unique vaultId
  │
Step 3: fetch-live-prices
  │  Fetch live prices from CoinMarketCap (fallback to hardcoded)
  │
Step 4: compute-ltvs
  │  For each position:
  │    - Calculate unrealized PnL (Long: units × (current - entry), Short: reverse)
  │    - Aggregate notional + PnL per vault
  │    - LTV = aggregate notional / (collateral + aggregate PnL)
  │
Step 5: fetch-thresholds
  │  Query Canton BrokerFundLink contracts for each broker-fund pair
  │  Returns: Record<"broker|fund", threshold>
  │
Step 5b: fetch-auto-liquidate-prefs
  │  Read KV keys (auto_liquidate:<broker>|<fund>) for each pair
  │  Returns: Record<"broker|fund", boolean>
  │
Step 6: margin-call-<positionId>  (for each breached position)
  │  If LTV >= threshold:
  │    - Create WorkflowMarginCall on Canton
  │    - Exercise MarkMarginCalled on the position
  │    - If auto-liquidate flag is true:
  │        1. Execute collateral seizure (workflow/liquidation.ts):
  │           a. Calculate liquidation amount = min(|PnL|, collateralValue)
  │           b. Inventory EVM escrow balances (ETH, USDC per chain)
  │           c. Inventory Canton-native assets (CC, CUSDC)
  │           d. Greedy waterfall: seize stablecoins first → CC → ETH
  │           e. EVM: call liquidateERC20/liquidate on escrow contracts
  │           f. Canton: transfer CC from custodian to broker via Splice
  │        2. Exercise LiquidatePosition on Canton with seized amount
  │
Step 7: update-ltv-<positionId>  (for each non-breached position)
     Update position's LTV on Canton with fresh values
```

### Decision Logic Per Position

```
LTV >= threshold?
  ├─ YES → Create margin call
  │         └─ Auto-liquidate enabled in KV?
  │              ├─ YES → Execute real collateral seizure:
  │              │         1. Read EVM escrow balances (ETH + USDC)
  │              │         2. Read Canton vault assets (CC, CUSDC)
  │              │         3. Seize in priority order (USDC → CUSDC → CC → ETH)
  │              │         4. EVM: liquidateERC20/liquidate via deployer key
  │              │         5. Canton: Splice transfer from custodian to broker
  │              │         6. Exercise LiquidatePosition on Canton
  │              └─ NO  → Wait for manual intervention
  └─ NO  → Update LTV on Canton (keeps UI fresh)
```

### Configuration

| Setting | Location | Description |
|---------|----------|-------------|
| Cron schedule | `workflow/wrangler.toml` | `* * * * *` (every minute, KV-gated) |
| Check interval | KV `workflow:check_interval` | Configurable: 1, 5, 15, 30, or 60 minutes (default 15). Set via `/api/workflow/config` or dashboard UI |
| Canton host | `workflow/wrangler.toml` vars | `CANTON_HOST` — Canton JSON API endpoint |
| Package ID | `workflow/wrangler.toml` vars | `PACKAGE_ID` — Daml DAR package hash |
| CMC API key | `workflow/wrangler.toml` vars | `COINMARKETCAP_API_KEY` — for live prices |
| RPC endpoints | `workflow/wrangler.toml` vars | `RPC_SEPOLIA`, `RPC_BASE_SEPOLIA`, `RPC_ETHEREUM`, `RPC_BASE` |
| Network mode | `workflow/wrangler.toml` vars | `NETWORK_MODE` — `testnet` or `mainnet` |
| Splice host | `workflow/wrangler.toml` vars | `SPLICE_HOST`, `SPLICE_PORT` — Splice validator API |
| Canton auth | `workflow/wrangler.toml` vars | `CANTON_AUTH_AUDIENCE`, `CUSTODIAN_USER` |
| Auth token | Wrangler secret | `CANTON_AUTH_TOKEN` — Canton bearer token |
| Operator party | Wrangler secret | `OPERATOR_PARTY` — Canton operator party ID |
| Deployer key | Wrangler secret | `DEPLOYER_PRIVATE_KEY` — EVM liquidator private key |
| Canton auth secret | Wrangler secret | `CANTON_AUTH_SECRET` — HS256 secret for Splice JWT |
| Auto-liquidate | KV namespace | `PRIVAMARGIN_CONFIG` — per broker-fund pair |

### Manual Trigger

The workflow exposes HTTP endpoints for manual operation:

```bash
# Trigger a run
curl -X POST https://<worker-url>/run

# Check status
curl https://<worker-url>/status?id=<instance-id>
```

### Deploy

```bash
cd workflow
wrangler deploy
```

Set secrets before first deploy:
```bash
wrangler secret put CANTON_AUTH_TOKEN
wrangler secret put OPERATOR_PARTY
wrangler secret put DEPLOYER_PRIVATE_KEY
wrangler secret put CANTON_AUTH_SECRET
```

---

## Auto-Liquidate Preference

Auto-liquidation is a **broker-side operational choice**, not a contractual term. It controls whether the LTV Monitor Workflow automatically liquidates positions when LTV exceeds the threshold, or just creates a margin call for manual handling.

When enabled, auto-liquidation triggers **real collateral seizure** — EVM escrow assets (ETH, USDC) are seized via the liquidator private key on-chain, and Canton-native assets (CC, CUSDC) are transferred from the custodian party to the broker via the Splice API. The position is then marked `Liquidated` on Canton.

### Storage

Preferences are stored in Cloudflare KV (`PRIVAMARGIN_CONFIG` namespace) with keys:

```
auto_liquidate:<broker-party-id>|<fund-party-id> = "true" | "false"
```

### Why KV (Not Daml)

The LTV threshold is a contractual term agreed upon by both broker and fund (stored on `BrokerFundLink`). Auto-liquidation, however, is a unilateral broker preference — the fund doesn't need to consent to how the broker handles breaches. Storing it off-ledger in KV:
- Avoids unnecessary contract exercises for a non-contractual setting
- Allows instant toggling without Daml transaction overhead
- Keeps the `BrokerFundLink` contract focused on mutual agreements

### API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auto-liquidate?broker=X&fund=Y` | GET | Single pair lookup → `{ enabled: boolean }` |
| `/api/auto-liquidate?broker=X` | GET | All preferences for a broker → `{ preferences: Record<fund, boolean> }` |
| `/api/auto-liquidate` | POST | Set preference → `{ broker, fund, enabled }` |

### Consumer

The LTV Monitor Workflow reads auto-liquidate preferences from KV in step 5b (`fetch-auto-liquidate-prefs`). If the flag is `true` for a broker-fund pair and a position breaches the threshold, the workflow executes full collateral seizure via `workflow/liquidation.ts` (EVM escrow liquidation + Splice CC transfer), then exercises `LiquidatePosition` on Canton with the total seized amount.

### UI

The broker's "Client Accounts" page (`BrokerFundLinks.tsx`) shows a toggle switch per linked fund. The toggle reads from `linkAPI.getAutoLiquidatePrefs(broker)` and writes via `linkAPI.setAutoLiquidate(broker, fund, enabled)`.

---

## API Layer

### `src/services/api.ts` (~2800 lines)

The central service layer. Communicates with Canton via `@stratos-wallet/sdk` and with EVM chains via Cloudflare Pages Functions.

| API Object | Description |
|------------|-------------|
| `roleAPI` | Role management — create operator, assign broker/fund, revoke, query assignments |
| `vaultAPI` | Vault lifecycle — create, deposit (EVM + CC), withdraw, deploy escrow, sync, close |
| `positionAPI` | Position lifecycle — create, list with live PnL, close, liquidate, get liquidation record |
| `marginAPI` | Margin verification with optional ZK proofs, margin call management |
| `linkAPI` | Broker-fund link queries, threshold/allowed-assets configuration |
| `invitationAPI` | Invitation send/accept/reject workflow |
| `proposalAPI` | LTV change proposal workflow (propose, accept, reject) |
| `assetAPI` | Platform asset types configuration, live price fetching via CoinGecko |
| `workflowMarginCallAPI` | Margin call lifecycle — list, acknowledge, resolve, cancel |

Key utility exports:
- `getLivePrice(symbol)` — Live price with CoinGecko + 60s cache, fallback to hardcoded
- `getOperatorParty()` / `getCustodianParty()` — Platform party lookups from `/api/config`

### `src/services/evmEscrow.ts`

EVM contract interaction utilities. Hand-rolled ABI encoding (no ethers.js dependency). Uses `viem` for contract deployment.

Key exports:
- `CHAIN_CONFIG` — Per-chain Uniswap V3 SwapRouter, WETH, USDC addresses
- `VAULT_ESCROW_BYTECODE` — Pre-compiled VaultEscrow bytecode (solc 0.8.34, optimized)
- `encode*` functions — ABI encoding for all escrow contract calls
- `deployEscrowContract()` — Client-side contract deployment via SDK
- `pollForContractAddress()` — Polls tx receipt until deployed address appears
- Network mode support (`testnet` / `mainnet` via `VITE_NETWORK_MODE` env var)

### `src/services/zkProof.ts`

ZK proof generation and verification. Loads circuit artifacts from `/zk/` static assets. See [Zero-Knowledge Proof System](#zero-knowledge-proof-system).

---

## Cloudflare Pages Functions

Serverless API endpoints deployed alongside the frontend. Use Cloudflare KV (`PRIVAMARGIN_CONFIG` namespace) for configuration persistence.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | GET/POST | Platform configuration — operator party, custodian party, platform assets |
| `/api/roles` | GET/POST/DELETE | Role assignment with permission checks (operator→broker/fund, broker→fund) |
| `/api/prices` | GET | Live asset prices via CoinMarketCap API, fallback to hardcoded |
| `/api/package` | GET | Application metadata — DAR package ID, template list, operator party |
| `/api/positions` | GET/POST | Position CRUD (KV-backed fallback when Canton unavailable) |
| `/api/invitations` | GET/POST | Invitation management (KV-backed fallback) |
| `/api/escrow/deploy` | GET/POST | Deploy VaultEscrow contracts using platform deployer private key |
| `/api/escrow/balances` | GET | Read on-chain ETH + USDC balances for an escrow address |
| `/api/custodian/accept-deposit` | POST | Accept CC transfer offers on custodian's behalf via Splice API |
| `/api/custodian/withdraw` | POST | Create CC transfer from custodian to user via Splice API |
| `/api/custodian/withdraw-usdc` | POST | Transfer USDCHolding from custodian to user via Canton JSON API (Split + Transfer) |
| `/api/swap/cc-to-usdc` | POST | Swap custodian CC for bridge operator USDC — Splice CC transfer + USDCHolding transfer back |
| `/api/auto-liquidate` | GET/POST | Broker auto-liquidate preferences per fund (KV-backed) |
| `/api/zkproof` | GET/POST | ZK proof storage — POST stores proof JSON under `zkproof:{hash}` with 30-day TTL, GET `?hash=` retrieves full proof |
| `/api/workflow/history` | GET | Workflow run history — list recent runs or fetch single run by timestamp |
| `/api/workflow/config` | GET/POST | Workflow check frequency — GET returns `{ checkInterval }`, POST accepts `{ checkInterval: 1|5|15|30|60 }` |
| `/api/admin/provision-custodian` | GET/POST | Provision dedicated vault-custodian Canton party |

### Escrow Deployment Details

`/api/escrow/deploy` uses a platform-owned deployer EOA (private key stored as Cloudflare secret `DEPLOYER_PRIVATE_KEY`). The deployer pays gas fees. Constructor parameters (owner address, liquidator address, chain-specific Uniswap/WETH/USDC addresses) are derived from the request and chain configuration. Authentication: same-origin trusted, cross-origin requires `X-Api-Secret` header.

### Custodian Provisioning

`/api/admin/provision-custodian` creates a headless "vault-custodian" party on Canton via the Splice validator admin API. This party holds CC on behalf of all vaults. The operator's user account is granted `actAs`/`readAs` rights for the custodian party via Canton JSON API user management (HS256 JWT authentication with `CANTON_AUTH_SECRET`).

---

## Frontend Pages

| Page | Route | Roles | Description |
|------|-------|-------|-------------|
| **Dashboard** | `/` | All | Role-specific overview with stats, ZK proof status, margin call alerts |
| **Vaults** | `/vaults` | Fund | Create vaults, deposit/withdraw assets, deploy escrows, sync balances |
| **Positions** | `/positions` | Fund, Broker | Open/close/liquidate positions, detail dialog with liquidation breakdown, ZK attestation verification |
| **My Brokers** | `/brokers` | Fund | View broker links, respond to invitations and LTV proposals |
| **Client Accounts** | `/funds` | Broker | Manage fund links, set thresholds and allowed assets |
| **Margin** | `/margin` | Fund, Broker | Margin verification with ZK proof generation |
| **Admin** | `/admin` | Operator | Role management, platform asset config, custodian/deployer provisioning |

### Dashboard Highlights

**Fund Dashboard**: Total assets value, capital protection status, open positions count, pending margin calls. Displays real ZK proof hash and what is disclosed vs. hidden from counterparties.

**Broker Dashboard**: Client fund count, total collateral (shown as "Encrypted" — only ZK-verified), active margin calls, tracked positions. Shows ZK verification status per fund.

**Operator Dashboard**: Party counts, custodian provisioning panel, deployer EOA configuration, Workflow Monitor panel (recent LTV check runs with per-position detail), role management navigation.

### Position Detail Dialog

Clicking any position row opens a modal showing full details:
- **All statuses**: Position ID, direction (Long/Short), vault ID, fund, broker, timestamps
- **Open/MarginCalled**: Notional, collateral, entry price, units, unrealized PnL (green/red), LTV progress bar with threshold marker, margin call warning banner
- **Liquidated**: Complete liquidation breakdown — per-chain escrow seizures table (chain, address, ETH seized, USDC seized, tx hashes), CC assets seized table, broker recipient, total seized amount
- **Closed**: Final notional value and PnL

---

## Chain Support

| Chain | ID | Mode | USDC Address | Uniswap V3 |
|-------|----|------|-------------|-------------|
| Ethereum | 1 | Mainnet | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | `0xE592427A0AEce92De3Edee1F18E0157C05861564` |
| Sepolia | 11155111 | Testnet | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` |
| Base | 8453 | Mainnet | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| Base Sepolia | 84532 | Testnet | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` |
| Canton | — | — | — | CC via Splice validator |

Network mode is controlled by `VITE_NETWORK_MODE` environment variable (`testnet` or `mainnet`). In testnet mode, chain name "Ethereum" maps to Sepolia, "Base" maps to Base Sepolia.

---

## Setup Guide

### Overview

PrivaMargin runs as a mini-app inside a Stratos Wallet portal. The portal handles user authentication (WebAuthn passkeys), multi-chain key management, and Canton SDK bridging. PrivaMargin runs in an iframe and communicates with Canton via the portal's SDK (`@stratos-wallet/sdk`).

```
┌──────────────────────────────────────────┐
│  Stratos Wallet Portal (parent window)   │
│  - WebAuthn auth, multi-chain keys       │
│  - Canton JSON API proxy (JWT)           │
│  - Dock: Trade | RWA | Vault | PrivaMargin│
├──────────────────────────────────────────┤
│  PrivaMargin (iframe)                    │
│  - Positions, Vaults, ZK Proofs          │
│  - SDK postMessage → Portal → Canton     │
└──────────────────────────────────────────┘
```

### Step 1: Install the Stratos Wallet Portal

The portal is created from the `stratos-init` base project using the interactive setup wizard.

```bash
cd stratos-init
./scripts/init-instance.sh
```

The wizard prompts for:
- **Instance name** — e.g. `wallet-privamargin` (becomes the Cloudflare project name)
- **Organization name** — displayed in the portal UI
- **Theme** — purple, teal, blue, orange, green, rose, or slate
- **WebAuthn RP ID** — your domain (e.g. `n1.cantondefi.com`)
- **Canton connection** — Splice host, JSON API host, auth credentials
- **Superadmin credentials** — username/password for the admin panel

The script creates a new directory (e.g. `../wallet-privamargin/`), provisions a Cloudflare D1 database, applies the schema, seeds default assets and RPC endpoints, and installs dependencies.

### Step 2: Deploy the Portal

```bash
cd ../wallet-privamargin
npm run build
npm run deploy
```

The portal is now live at your configured domain (e.g. `https://n1.cantondefi.com`).

### Step 3: Register PrivaMargin as a Mini-App

Login to the portal's admin panel at `/admin` and add PrivaMargin to the app dock.

**Via the admin UI:**
1. Navigate to the **Apps** section
2. Click **Add App**
3. Fill in:
   - **ID**: `privamargin`
   - **Name**: `PrivaMargin`
   - **Icon**: `📊` (or any emoji/character)
   - **Color**: `#6366f1`
   - **URL**: `https://stratos-privamargin.pages.dev` (or your deployment URL)
   - **Sort Order**: position in the dock (e.g. `3`)
   - **Enabled**: Yes
4. Save

**Via the API:**
```bash
curl -X POST https://n1.cantondefi.com/api/superadmin/apps \
  -H "Content-Type: application/json" \
  -H "Cookie: <admin-session>" \
  -d '{
    "id": "privamargin",
    "name": "PrivaMargin",
    "icon": "📊",
    "color": "#6366f1",
    "url": "https://stratos-privamargin.pages.dev",
    "sort_order": 3,
    "is_enabled": true
  }'
```

PrivaMargin now appears in the portal dock. Users click it to open in an iframe with full SDK access.

### Step 4: Create User Accounts

Each participant (fund, broker, operator) needs a portal account. Users register via WebAuthn passkey at the portal login page. The portal assigns each user a Canton party ID.

For the **operator** role, assign via the PrivaMargin admin page (`/admin` within PrivaMargin) after logging in with the operator's account.

### Step 5: Build and Deploy PrivaMargin

#### Prerequisites

- Node.js 18+
- Daml SDK 3.4.9 (for DAR compilation)
- Cloudflare account with Wrangler CLI
- `@stratos-wallet/sdk` (local linked package at `../stratos-wallet-sdk`)

#### Install Dependencies

```bash
cd stratos-privamargin
npm install
```

#### Build Daml Package

```bash
npm run build:dar
```

Compiles Daml sources in `daml/src/`, updates `PACKAGE_ID` in `wrangler.toml` to the new DAR hash, and copies the DAR to `public/package.dar`.

#### Deploy DAR to Canton

Upload the DAR to all Canton participant nodes:

1. Open the portal admin at each participant (e.g. `https://n1.cantondefi.com/admin`)
2. Navigate to the DAR upload / package management section
3. Upload `daml/.daml/dist/privamargin6-0.1.0.dar`
4. Repeat for each participant node

The new package must be deployed to all participants before the frontend can use the updated templates.

#### Update Package ID

After deploying the DAR, update the package ID in:
- `wrangler.toml` → `PACKAGE_ID` (auto-updated by `build:dar`)
- `src/services/api.ts` → `CPCV_PACKAGE_ID` (hardcoded, must match)
- `workflow/wrangler.toml` → `PACKAGE_ID` (if using the workflow worker)

All three must be the same hash.

#### Build ZK Circuit (optional — artifacts may be pre-built)

```bash
npm run build:zk
```

Requires `circom2`. Runs the trusted setup ceremony and outputs WASM, zkey, and verification key to `public/zk/`.

#### Build Frontend

```bash
npm run build
```

Runs `copy-dar` → TypeScript compilation → Vite build. Output in `dist/`.

#### Deploy to Cloudflare Pages

```bash
npx wrangler pages deploy dist --project-name=stratos-privamargin --branch=production --commit-dirty=true
```

Set secrets (one-time):

```bash
wrangler pages secret put DEPLOYER_PRIVATE_KEY   # Hex-encoded EOA private key for escrow deployment
wrangler pages secret put API_SECRET              # Shared secret for cross-origin API auth
```

### Step 6: Configure PrivaMargin

After deploying, open PrivaMargin from the portal dock as the **operator** user.

1. **Assign roles** — Go to Admin page, assign broker and fund roles to registered users
2. **Provision custodian** — Click "Provision Custodian" to create the headless vault-custodian party on Canton
3. **Configure deployer** — Set the EVM deployer address for escrow contract deployment
4. **Start LTV monitor** — On the Dashboard, click "Start Monitor" to begin operator-driven LTV polling (every 30s)

### Step 7: Fund and Broker Onboarding

**Broker:**
1. Login to portal, open PrivaMargin
2. Go to Client Accounts, invite a fund (by party ID)
3. Set LTV threshold and allowed assets on the link

**Fund:**
1. Login to portal, open PrivaMargin
2. Accept broker invitation in My Brokers
3. Create a vault in Vault Management, deposit collateral (CC, USDC, ETH)
4. Open positions against the vault

### Development Server

```bash
npm run dev
```

Starts Vite dev server on port 5175. For local development outside the portal iframe, the SDK calls fall back to direct API calls.

### Type Check

```bash
npm run lint    # runs tsc --noEmit
```

### Configuration (`wrangler.toml`)

| Variable | Description |
|----------|-------------|
| `PACKAGE_ID` | Daml DAR package hash (auto-updated by `build:dar`) |
| `COINMARKETCAP_API_KEY` | CoinMarketCap API key for live price feeds |
| `RPC_SEPOLIA` / `RPC_BASE_SEPOLIA` | Testnet EVM RPC endpoints |
| `RPC_ETHEREUM` / `RPC_BASE` | Mainnet EVM RPC endpoints |
| `SPLICE_HOST` / `SPLICE_PORT` | Canton/Splice validator host and port |
| `CANTON_AUTH_SECRET` | HS256 secret for Canton JSON API JWT authentication |
| `CANTON_AUTH_AUDIENCE` | JWT audience claim for Canton auth |
| `CUSTODIAN_USER` | Headless custodian user ID on Canton |

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `@stratos-wallet/sdk` | Canton Network wallet SDK (local link) |
| `snarkjs` | Groth16 ZK proof generation/verification (in-browser WASM) |
| `viem` | EVM contract deployment and chain interaction |
| `react` / `react-dom` | UI framework (v19) |
| `@mui/material` | Material UI component library |
| `recharts` | Dashboard data visualization charts |
| `react-router-dom` | Client-side routing (HashRouter) |
| `circom2` / `circomlib` | ZK circuit compilation (dev only) |
| `solc` | Solidity contract compilation (dev only) |
| `wrangler` | Cloudflare Pages deployment CLI (dev only) |

### Project Structure

```
stratos-privamargin/
├── circuits/
│   ├── ltv_verifier.circom    # ZK circuit (Groth16, 10 assets)
│   └── build.sh               # Trusted setup + artifact generation
├── contracts/
│   └── VaultEscrow.sol        # Per-vault EVM escrow contract
├── daml/
│   ├── daml.yaml              # Daml SDK config (3.4.9, Canton 2.1)
│   └── src/
│       ├── Assets.daml        # TokenizedAsset, AssetIssuance
│       ├── BrokerFundLink.daml # Invitations, links, LTV proposals
│       ├── CollateralLock.daml # Self-custody CC pledges
│       ├── CollateralVault.daml # Vault with multi-chain escrows
│       ├── MarginVerification.daml # Margin calls, settlements
│       ├── Position.daml      # Trading positions with PnL
│       └── Roles.daml         # Operator, broker, fund roles
├── functions/api/             # Cloudflare Pages Functions
│   ├── config.ts              # Platform configuration
│   ├── zkproof.ts             # ZK proof KV storage (POST store, GET retrieve)
│   ├── auto-liquidate.ts      # Broker auto-liquidate prefs (KV)
│   ├── workflow/
│   │   ├── history.ts         # Workflow run history (KV-backed)
│   │   └── config.ts          # Workflow check frequency config (KV-backed)
│   ├── prices.ts              # Live asset prices
│   ├── roles.ts               # Role assignment
│   ├── positions.ts           # Position CRUD (KV fallback)
│   ├── invitations.ts         # Invitation management
│   ├── package.ts             # App metadata
│   ├── escrow/
│   │   ├── deploy.ts          # VaultEscrow deployment
│   │   └── balances.ts        # On-chain balance reads
│   ├── custodian/
│   │   ├── accept-deposit.ts  # Accept CC transfer offers
│   │   ├── withdraw.ts        # Create CC transfer offers (Splice)
│   │   └── withdraw-usdc.ts   # Transfer USDCHolding (Canton JSON API)
│   ├── swap/
│   │   └── cc-to-usdc.ts      # CC→USDC swap via bridge operator
│   ├── canton/
│   │   └── seize-collateral.ts # SeizeCollateral vault exercise
│   └── admin/
│       └── provision-custodian.ts # Canton custodian party setup
├── public/
│   ├── package.dar            # Compiled Daml package
│   └── zk/                    # ZK circuit artifacts (WASM, zkey, vkey)
├── src/
│   ├── App.tsx                # Shell, routing, role gate
│   ├── pages/
│   │   ├── Dashboard.tsx      # Role-specific dashboards
│   │   ├── Positions.tsx      # Position management + detail dialog
│   │   └── VaultManagement.tsx # Vault lifecycle management
│   └── services/
│       ├── api.ts             # Core API layer (~3400 lines)
│       ├── ltvMonitor.ts      # Operator LTV monitor (SDK polling, 30s)
│       ├── evmEscrow.ts       # EVM ABI encoding + chain config
│       └── zkProof.ts         # Groth16 proof generation/verification
├── workflow/
│   ├── wrangler.toml          # Workflow worker config (KV binding)
│   └── ltv-monitor.ts         # LTV Monitor Workflow (reference, cron disabled)
├── package.json
├── vite.config.ts             # Vite config (port 5175)
└── wrangler.toml              # Cloudflare Pages config + env vars
```
