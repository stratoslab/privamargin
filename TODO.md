# PrivaMargin TODO

## Completed

- [x] Add `chainVaults` and `depositRecords` Optional fields to CollateralVault Daml template
- [x] Add `DepositAssetWithTx` choice (deposits with txId/chain tracking)
- [x] Add `RegisterChainVault` choice (register chain custody addresses)
- [x] Add `RecordDeposit` choice (record deposit tx details)
- [x] Rename DAR to `privamargin3`, rebuild
- [x] Add `vaultAPI.depositReal()` — real wallet transfer via SDK + Daml recording
- [x] Update `Vault` interface with `chainVaults` and `depositRecords`
- [x] Update `contractToVault()` to parse new Optional tuple fields
- [x] Add chain selection to deposit dialog (auto-selects single-chain assets)
- [x] Show deposit records and chain custody info on vault cards
- [x] Show deposit transfer status (pending/confirmed) in dialog
- [x] Update package IDs in api.ts, wrangler.toml, workflow/wrangler.toml

## Vault Custodian (Completed)

- [x] Add `/api/admin/provision-custodian` endpoint (provisions headless party via wallet admin API)
- [x] Update `/api/config` to store/return `custodianParty` alongside `operatorParty`
- [x] Add `getCustodianParty()` to `src/services/api.ts`
- [x] Update `vaultAPI.create()` to use custodian party as vault operator
- [x] Update `vaultAPI.depositReal()` to transfer tokens to custodian party
- [x] Grant admin user actAs/readAs rights for custodian party (multi-signatory support)
- [x] Create `vault-custodian/` Cloudflare Worker (auto-accepts transfer offers, processes withdrawals)
- [x] Show custodian info on vault cards in VaultManagement page
- [x] Add "Provision Custodian" button on operator Dashboard

## EVM Escrow (Completed)

- [x] Create `VaultEscrow.sol` — per-vault Solidity escrow contract (owner-only withdraw)
- [x] Compile with `solcjs`, embed deployment bytecode in `evmEscrow.ts`
- [x] Hand-rolled ABI encoding helpers (`encodeWithdrawETH`, `encodeWithdrawERC20`, `encodeGetBalance`)
- [x] Make `EVMTransactionRequest.to` optional in SDK + wallet (for contract deployment)
- [x] Fix `signTransaction()` to handle missing `to` (empty RLP byte for contract creation)
- [x] Fix `estimateGas()` to omit `to` param and use higher gas default for deployment
- [x] Add `getTransactionReceipt` to SDK, wallet bridge, and App.tsx
- [x] Add `deployEscrowContract()` + `pollForContractAddress()` helpers
- [x] Add `vaultAPI.deployEVMEscrow()` — deploys contract, registers via `RegisterChainVault`
- [x] Update `vaultAPI.depositReal()` — routes EVM deposits to escrow contract when registered
- [x] Add `vaultAPI.withdrawFromEscrow()` — calls escrow withdraw via `sendContractCall()`
- [x] Add "Deploy EVM Escrow" button on vault cards (shown when no escrow registered)
- [x] Enhanced chain vault display — Etherscan link, EVM vs Canton visual differentiation
- [x] Escrow-aware deposit dialog — shows escrow contract address when depositing to EVM chain
- [x] "Withdraw from Escrow" button per chain vault with amount dialog

## Liquidation (Completed)

- [x] Add `liquidator` address + `onlyLiquidator` modifier to `VaultEscrow.sol`
- [x] Add `liquidate()` and `liquidateERC20()` functions to escrow contract
- [x] Add `Deposited`, `Withdrawn`, `Liquidated` events to escrow contract
- [x] Recompile escrow contract, update bytecode in `evmEscrow.ts`
- [x] Add `encodeLiquidateETH()` and `encodeLiquidateERC20()` ABI helpers
- [x] Update `deployEscrowContract()` to accept liquidator address as constructor arg
- [x] Add `LiquidatePosition` choice to `Position.daml` with LTV threshold assertion
- [x] Fix `positionAPI.create()` to use real operator party (enables operator-controlled choices)
- [x] Update `vaultAPI.deployEVMEscrow()` to resolve operator EVM address as liquidator
- [x] Add `positionAPI.liquidate()` — full orchestration (LTV check, EVM tx, Daml exercise)
- [x] Add Liquidate button + confirmation dialog in broker Positions view
- [x] Add `Liquidated` status chip styling in broker and fund views

## Phase 2 (Future)

- [ ] Implement withdrawal detection in custodian worker (Canton updates stream)
- [ ] Add deposit confirmation polling (check txId status on-chain)
- [ ] Add multi-sig custody for EVM vault contracts
- [ ] Support partial withdrawals from vault
