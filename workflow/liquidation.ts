/**
 * Liquidation Module — collateral seizure logic for auto-liquidation.
 *
 * When the LTV Monitor detects a breach with auto-liquidate enabled,
 * this module executes the actual collateral seizure:
 *   - EVM escrow assets (ETH, USDC) via the liquidator private key,
 *     then bridged to Canton USDC via Stratos Swap router
 *   - Canton-native assets (CC, CUSDC) converted to Canton USDC
 *     via custodian USDCHolding Split+Transfer
 *
 * The broker always receives Canton USDC regardless of collateral source.
 *
 * Bridge reference: https://swap.cantondefi.com/docs/
 *   - swapToCanton(token, amount, cantonPartyId, nonce) — EVM USDC → Canton USDC
 *   - swapToCantonETH(cantonPartyId, nonce) — EVM ETH → Canton USDC
 *
 * Authorization note:
 *   The Daml CollateralVault.WithdrawAsset choice has `controller owner` (the fund).
 *   The workflow authenticates as the operator, which is only an observer on vaults.
 *   For EVM assets, the liquidator private key has direct on-chain authority via
 *   VaultEscrow, then the Stratos Swap router bridges USDC to Canton.
 *   For Canton CC, the custodian transfers USDCHolding to the broker.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  type Chain,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia, baseSepolia, mainnet, base } from 'viem/chains';

// ============================================
// A. CONSTANTS
// ============================================

/** USDC contract addresses per chain */
const USDC_ADDRESSES: Record<number, string> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

/** Chain name → chain ID mappings (network-mode aware) */
const CHAIN_NAME_TO_ID_TESTNET: Record<string, number> = {
  'Ethereum': 11155111,
  'Sepolia': 11155111,
  'Base': 84532,
  'Base Sepolia': 84532,
};

const CHAIN_NAME_TO_ID_MAINNET: Record<string, number> = {
  'Ethereum': 1,
  'Sepolia': 11155111,
  'Base': 8453,
  'Base Sepolia': 84532,
};

/** Chain configs with viem Chain objects */
const CHAIN_CONFIG: Record<number, { chain: Chain; swapRouter: string; weth: string; usdc: string }> = {
  1:        { chain: mainnet,     swapRouter: '0xE592427A0AEce92De3Edee1F18E0157C05861564', weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  11155111: { chain: sepolia,     swapRouter: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E', weth: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
  8453:     { chain: base,        swapRouter: '0x2626664c2603336E57B271c5C0b26F421741e481', weth: '0x4200000000000000000000000000000000000006', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  84532:    { chain: baseSepolia, swapRouter: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4', weth: '0x4200000000000000000000000000000000000006', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
};

/**
 * Stratos Swap router addresses — bridges EVM USDC to Canton USDC.
 * See https://swap.cantondefi.com/docs/
 */
const STRATOS_SWAP_ROUTER: Record<number, string> = {
  11155111: '0x8d151386339db9ced7a6cf4a5b5357315f4846ef', // Ethereum Sepolia
  84532:    '0x8d151386339db9ced7a6cf4a5b5357315f4846ef', // Base Sepolia
};

/** Resolve RPC URL from env for a given chain ID */
function getRpcUrl(env: LiquidationEnv, chainId: number): string {
  switch (chainId) {
    case 1: return env.RPC_ETHEREUM || 'https://ethereum-rpc.publicnode.com';
    case 11155111: return env.RPC_SEPOLIA || 'https://ethereum-sepolia-rpc.publicnode.com';
    case 8453: return env.RPC_BASE || 'https://base-rpc.publicnode.com';
    case 84532: return env.RPC_BASE_SEPOLIA || 'https://base-sepolia-rpc.publicnode.com';
    default: return env.RPC_SEPOLIA || 'https://ethereum-sepolia-rpc.publicnode.com';
  }
}

// ============================================
// B. ABI ENCODING HELPERS
// ============================================

// Function selectors from VaultEscrow.sol
const SEL_LIQUIDATE_ETH = '0710285c';   // liquidate(address,uint256,uint256)
const SEL_LIQUIDATE_ERC20 = '655f26b4'; // liquidateERC20(address,address,uint256)

/** Pad a hex address to 32 bytes (64 hex chars), left-padded with zeros */
function padAddress(addr: string): string {
  const clean = addr.startsWith('0x') ? addr.slice(2) : addr;
  return clean.toLowerCase().padStart(64, '0');
}

/** Encode a uint256 (number or bigint) as 32 bytes hex */
function padUint256(value: bigint | number | string): string {
  let n: bigint;
  if (typeof value === 'string') {
    n = BigInt(value);
  } else {
    n = BigInt(value);
  }
  return n.toString(16).padStart(64, '0');
}

/** Encode liquidate(address to, uint256 amount, uint256 amountOutMinimum) call data */
function encodeLiquidateETH(to: string, amountWei: bigint | string, amountOutMin: bigint | string): string {
  return '0x' + SEL_LIQUIDATE_ETH + padAddress(to) + padUint256(amountWei) + padUint256(amountOutMin);
}

/** Encode liquidateERC20(address token, address to, uint256 amount) call data */
function encodeLiquidateERC20(token: string, to: string, amount: bigint | string): string {
  return '0x' + SEL_LIQUIDATE_ERC20 + padAddress(token) + padAddress(to) + padUint256(amount);
}

// Stratos Swap router function selectors (https://swap.cantondefi.com/docs/)
const SEL_APPROVE = '095ea7b3';             // approve(address,uint256)
const SEL_SWAP_TO_CANTON = '1d0212ca';      // swapToCanton(address,uint256,string,uint256)

/** Encode ERC20 approve(address spender, uint256 amount) */
function encodeApprove(spender: string, amount: bigint | string): string {
  return '0x' + SEL_APPROVE + padAddress(spender) + padUint256(amount);
}

/**
 * Encode swapToCanton(address token, uint256 amount, string cantonPartyId, uint256 nonce).
 * The string param uses dynamic ABI encoding (offset pointer + length + padded data).
 */
function encodeSwapToCanton(token: string, amount: bigint | string, cantonPartyId: string, nonce: bigint | string): string {
  const tokenEnc = padAddress(token);
  const amountEnc = padUint256(amount);
  // Dynamic offset: 4 slots * 32 bytes = 128 = 0x80
  const offsetEnc = padUint256(128);
  const nonceEnc = padUint256(nonce);
  // String encoding: length + data padded to 32-byte boundary
  const strBytes = new TextEncoder().encode(cantonPartyId);
  const strLenEnc = padUint256(strBytes.length);
  const strHex = Array.from(strBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const paddedLen = Math.ceil(strBytes.length / 32) * 32;
  const strDataEnc = strHex.padEnd(paddedLen * 2, '0');

  return '0x' + SEL_SWAP_TO_CANTON + tokenEnc + amountEnc + offsetEnc + nonceEnc + strLenEnc + strDataEnc;
}

// ============================================
// C. EVM BALANCE READING
// ============================================

/** Raw JSON-RPC call */
async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json() as { result?: unknown; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

/** Fetch ETH and USDC balances for an escrow address on a given chain */
async function fetchEscrowBalances(env: LiquidationEnv, address: string, chainId: number): Promise<{ eth: bigint; usdc: bigint }> {
  const rpcUrl = getRpcUrl(env, chainId);

  // Get native ETH balance
  const ethBalanceHex = await rpcCall(rpcUrl, 'eth_getBalance', [address, 'latest']) as string;
  const eth = BigInt(ethBalanceHex);

  // Get USDC balance via balanceOf(address)
  let usdc = 0n;
  const usdcAddress = USDC_ADDRESSES[chainId];
  if (usdcAddress) {
    const paddedAddr = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');
    const usdcHex = await rpcCall(rpcUrl, 'eth_call', [
      { to: usdcAddress, data: paddedAddr },
      'latest',
    ]) as string;
    usdc = BigInt(usdcHex || '0x0');
  }

  return { eth, usdc };
}

// ============================================
// D. EVM TRANSACTION EXECUTION
// ============================================

/** Send a liquidation transaction to an escrow contract */
async function sendLiquidationTx(
  env: LiquidationEnv,
  escrowAddress: string,
  callData: string,
  chainId: number,
): Promise<{ txHash: string }> {
  const config = CHAIN_CONFIG[chainId];
  if (!config) throw new Error(`Unsupported chainId: ${chainId}`);

  const rawKey = env.DEPLOYER_PRIVATE_KEY.trim();
  const privateKey = rawKey.startsWith('0x') ? rawKey as Hex : `0x${rawKey}` as Hex;
  const account = privateKeyToAccount(privateKey);

  const rpcUrl = getRpcUrl(env, chainId);

  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: config.chain,
    transport: http(rpcUrl),
  });

  const gasEstimate = await publicClient.estimateGas({
    account: account.address,
    to: escrowAddress as Hex,
    data: callData as Hex,
  });

  const txHash = await walletClient.sendTransaction({
    to: escrowAddress as Hex,
    data: callData as Hex,
    gas: gasEstimate + (gasEstimate / 10n), // +10% buffer
  });

  // Wait for receipt
  await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 120_000,
  });

  return { txHash };
}

// ============================================
// D2. STRATOS SWAP BRIDGE (EVM USDC → Canton USDC)
// ============================================

/** Read deployer's USDC balance on a given chain */
async function getUSDCBalance(env: LiquidationEnv, address: string, chainId: number): Promise<bigint> {
  const rpcUrl = getRpcUrl(env, chainId);
  const usdcAddress = USDC_ADDRESSES[chainId];
  if (!usdcAddress) return 0n;
  const callData = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');
  const result = await rpcCall(rpcUrl, 'eth_call', [
    { to: usdcAddress, data: callData },
    'latest',
  ]) as string;
  return BigInt(result || '0x0');
}

/**
 * Bridge EVM USDC to Canton USDC via Stratos Swap router.
 * 1. Approve router to spend deployer's USDC
 * 2. Call swapToCanton → broker receives Canton USDC (~3-5 min delivery)
 *
 * See https://swap.cantondefi.com/docs/
 */
async function bridgeToCantonUSDC(
  env: LiquidationEnv,
  chainId: number,
  usdcAmount: bigint,
  brokerCantonPartyId: string,
): Promise<{ approveTxHash: string; swapTxHash: string }> {
  const routerAddr = STRATOS_SWAP_ROUTER[chainId];
  if (!routerAddr) throw new Error(`No Stratos Swap router for chainId ${chainId}`);

  const usdcAddr = USDC_ADDRESSES[chainId];
  if (!usdcAddr) throw new Error(`No USDC address for chainId ${chainId}`);

  // Step 1: Approve swap router to spend USDC
  const approveData = encodeApprove(routerAddr, usdcAmount);
  const { txHash: approveTxHash } = await sendLiquidationTx(env, usdcAddr, approveData, chainId);
  console.log(`[Liquidation] Approved Stratos Swap router for ${usdcAmount} USDC (tx: ${approveTxHash})`);

  // Step 2: Call swapToCanton
  const nonce = BigInt(Date.now());
  const swapData = encodeSwapToCanton(usdcAddr, usdcAmount, brokerCantonPartyId, nonce);
  const { txHash: swapTxHash } = await sendLiquidationTx(env, routerAddr, swapData, chainId);
  console.log(`[Liquidation] Stratos Swap initiated: ${usdcAmount} USDC → Canton USDC for ${brokerCantonPartyId} (tx: ${swapTxHash})`);

  return { approveTxHash, swapTxHash };
}

// ============================================
// E. SPLICE CC TRANSFER (fallback)
// ============================================

/** Base64url encode a Uint8Array */
function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Generate HS256 JWT for Splice/Canton API auth (WebCrypto — no jsonwebtoken needed) */
async function generateJWT(env: LiquidationEnv, user?: string): Promise<string> {
  const encoder = new TextEncoder();
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: user || env.CUSTODIAN_USER || 'vault-custodian',
    aud: env.CANTON_AUTH_AUDIENCE || 'https://canton.network.global',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  const headerB64 = base64url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64url(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.CANTON_AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput))
  );

  return `${signingInput}.${base64url(signature)}`;
}

/** Transfer CC from custodian to broker via Splice transfer offer */
async function transferCCToBroker(
  env: LiquidationEnv,
  receiverParty: string,
  amount: number,
): Promise<{ contractId: string; trackingId: string }> {
  const host = env.SPLICE_HOST || 'p1.cantondefi.com';
  const port = parseInt(env.SPLICE_PORT || '443');
  const protocol = port === 443 ? 'https' : 'http';
  const portStr = port === 443 ? '' : `:${port}`;
  const baseUrl = `${protocol}://${host}${portStr}/api/validator/v0`;

  const token = await generateJWT(env);
  const expiresAtMicros = (Date.now() + 60 * 60 * 1000) * 1000;
  const trackingId = `auto-liquidation-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  const res = await fetch(`${baseUrl}/wallet/transfer-offers`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      receiver_party_id: receiverParty,
      amount: amount.toString(),
      description: 'Auto-liquidation collateral seizure',
      expires_at: expiresAtMicros.toString(),
      tracking_id: trackingId,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Splice transfer failed (${res.status}): ${errText}`);
  }

  const result = await res.json() as { offer_contract_id?: string; contract_id?: string };
  const contractId = result.offer_contract_id || result.contract_id || '';

  return { contractId, trackingId };
}

// ============================================
// E2. CANTON USDC TRANSFER (custodian → broker)
// ============================================

/** Call Canton JSON API v2 endpoint with JWT auth */
async function cantonV2Fetch<T>(env: LiquidationEnv, endpoint: string, body?: unknown): Promise<T> {
  const host = env.CANTON_HOST || 'localhost';
  const url = `https://${host}/v2${endpoint}`;
  const token = await generateJWT(env, env.SPLICE_ADMIN_USER || 'app-user');
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Canton v2 API ${res.status}: ${errText}`);
  }
  return res.json() as Promise<T>;
}

/** Exercise a choice on a Canton contract via JSON API v2 */
async function exerciseCantonV2Choice(
  env: LiquidationEnv,
  actAs: string,
  contractId: string,
  templateId: string,
  choice: string,
  argument: Record<string, unknown>,
): Promise<{ created: Array<{ contractId: string; payload: Record<string, unknown> }> }> {
  const commandId = crypto.randomUUID();
  const result = await cantonV2Fetch<{
    transactionTree: {
      eventsById: Record<string, {
        ExercisedTreeEvent?: { value: { exerciseResult: unknown } };
        CreatedTreeEvent?: { value: { contractId: string; createArgument: Record<string, unknown> } };
      }>;
    }
  }>(env, '/commands/submit-and-wait-for-transaction-tree', {
    commands: [{
      ExerciseCommand: { templateId, contractId, choice, choiceArgument: argument }
    }],
    commandId,
    actAs: [actAs],
    readAs: [actAs],
  });

  const created: Array<{ contractId: string; payload: Record<string, unknown> }> = [];
  for (const [, event] of Object.entries(result.transactionTree?.eventsById || {})) {
    if (event.CreatedTreeEvent) {
      created.push({
        contractId: event.CreatedTreeEvent.value.contractId,
        payload: event.CreatedTreeEvent.value.createArgument,
      });
    }
  }
  return { created };
}

/**
 * Transfer Canton USDCHolding from custodian to broker.
 * Uses Canton JSON API v2 Split+Transfer (same logic as withdraw-usdc.ts).
 * Falls back to CC transfer via Splice if USDC transfer is unavailable.
 */
async function transferCantonUSDCToBroker(
  env: LiquidationEnv,
  brokerParty: string,
  amountUSD: number,
  custodianParty: string,
): Promise<{ success: boolean; method: 'usdc' | 'cc'; error?: string }> {
  const templateId = env.USDC_TEMPLATE_ID;
  if (!templateId || !env.CANTON_HOST || !custodianParty) {
    // Fallback: transfer CC via Splice
    console.log(`[Liquidation] USDC transfer not configured, falling back to CC transfer`);
    await transferCCToBroker(env, brokerParty, amountUSD);
    return { success: true, method: 'cc' };
  }

  try {
    // Get admin party
    const adminUser = env.SPLICE_ADMIN_USER || 'app-user';
    const adminResult = await cantonV2Fetch<{ user: { primaryParty: string } }>(
      env, `/users/${adminUser}`
    );
    const adminPartyId = adminResult.user.primaryParty;

    // Query custodian's USDCHolding contracts
    const offsetResult = await cantonV2Fetch<{ offset: number }>(env, '/state/ledger-end');
    const filtersByParty: Record<string, unknown> = {
      [adminPartyId]: {
        cumulative: [{
          identifierFilter: {
            TemplateFilter: {
              value: { templateId, includeCreatedEventBlob: false }
            }
          }
        }]
      }
    };

    const rawContracts = await cantonV2Fetch<Array<{
      contractEntry: {
        JsActiveContract: {
          createdEvent: {
            contractId: string;
            templateId: string;
            createArgument: Record<string, unknown>;
          }
        }
      }
    }>>(env, '/state/active-contracts', {
      filter: { filtersByParty },
      verbose: true,
      activeAtOffset: offsetResult.offset,
    });

    // Parse custodian's holdings
    const contracts = (rawContracts || [])
      .map(c => ({
        contractId: c.contractEntry.JsActiveContract.createdEvent.contractId,
        tid: c.contractEntry.JsActiveContract.createdEvent.templateId,
        payload: c.contractEntry.JsActiveContract.createdEvent.createArgument,
      }))
      .filter(c => c.tid === templateId && c.payload.owner === custodianParty);

    let available = 0;
    for (const c of contracts) {
      available += parseFloat(c.payload.amount as string) || 0;
    }

    if (available < amountUSD) {
      console.warn(`[Liquidation] Insufficient custodian USDC: have ${available}, need ${amountUSD}. Falling back to CC transfer.`);
      await transferCCToBroker(env, brokerParty, amountUSD);
      return { success: true, method: 'cc' };
    }

    // Split+Transfer USDCHolding to broker (largest contracts first)
    const sorted = [...contracts].sort((a, b) =>
      (parseFloat(b.payload.amount as string) || 0) - (parseFloat(a.payload.amount as string) || 0)
    );

    let remaining = amountUSD;
    for (const contract of sorted) {
      if (remaining <= 0) break;
      const contractAmount = parseFloat(contract.payload.amount as string) || 0;

      if (contractAmount <= remaining) {
        await exerciseCantonV2Choice(env, adminPartyId, contract.contractId, templateId, 'Transfer', { newOwner: brokerParty });
        remaining -= contractAmount;
      } else {
        // Split: take what we need
        const splitResult = await exerciseCantonV2Choice(env, adminPartyId, contract.contractId, templateId, 'Split', { splitAmount: remaining.toString() });
        for (const evt of splitResult.created) {
          const evtAmount = parseFloat(evt.payload.amount as string) || 0;
          if (Math.abs(evtAmount - remaining) < 0.000001) {
            await exerciseCantonV2Choice(env, adminPartyId, evt.contractId, templateId, 'Transfer', { newOwner: brokerParty });
            break;
          }
        }
        remaining = 0;
      }
    }

    console.log(`[Liquidation] Transferred ${amountUSD} Canton USDC to broker ${brokerParty}`);
    return { success: true, method: 'usdc' };
  } catch (err) {
    // Fallback to CC transfer
    console.error(`[Liquidation] Canton USDC transfer failed, falling back to CC:`, err);
    try {
      await transferCCToBroker(env, brokerParty, amountUSD);
      return { success: true, method: 'cc', error: `USDC failed (${err}), fell back to CC` };
    } catch (ccErr) {
      return { success: false, method: 'cc', error: `Both USDC (${err}) and CC (${ccErr}) transfers failed` };
    }
  }
}

// ============================================
// F. VAULT CHAIN VAULTS PARSER
// ============================================

/** Normalize Canton JSON API encoding of Optional [(Text, Text)] into typed array */
export function parseChainVaults(
  raw: Array<[string, string]> | Array<{ _1: string; _2: string }> | null | undefined
): Array<{ chain: string; address: string }> {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map(item => {
    if (Array.isArray(item)) {
      return { chain: item[0], address: item[1] };
    }
    return { chain: item._1, address: item._2 };
  });
}

// ============================================
// G. MAIN ORCHESTRATOR
// ============================================

/** Env fields needed by the liquidation module */
export interface LiquidationEnv {
  DEPLOYER_PRIVATE_KEY: string;
  RPC_SEPOLIA: string;
  RPC_BASE_SEPOLIA: string;
  RPC_ETHEREUM: string;
  RPC_BASE: string;
  NETWORK_MODE: string;
  CANTON_AUTH_SECRET: string;
  SPLICE_HOST: string;
  SPLICE_PORT: string;
  CANTON_AUTH_AUDIENCE: string;
  CUSTODIAN_USER: string;
  // Canton JSON API v2 — for USDC transfer from custodian to broker
  CANTON_HOST?: string;
  USDC_TEMPLATE_ID?: string;
  SPLICE_ADMIN_USER?: string;
}

export interface LiquidationParams {
  env: LiquidationEnv;
  position: {
    contractId: string;
    positionId: string;
    vaultId: string;
    fund: string;
    broker: string;
    notional: number;
    collateralValue: number;
    pnl: number;
    currentLTV: number;
  };
  vault: {
    contractId: string;
    payload: {
      owner: string;
      operator: string;
      vaultId: string;
      collateralAssets: Array<{
        assetId: string;
        assetType: string;
        amount: string;
        valueUSD: string;
      }>;
      linkedPositions: string[];
      chainVaults?: Array<[string, string]> | Array<{ _1: string; _2: string }> | null;
    };
  };
  prices: Record<string, number>;
  threshold: number;
  custodianParty?: string;
}

export interface LiquidationResult {
  success: boolean;
  liquidationAmountUSD: number;
  totalSeizedUSD: number;
  escrowSeizures: Array<{
    chain: string;
    type: string;
    amountWei: string;
    valueUSD: number;
    txHash?: string;
    error?: string;
  }>;
  cantonSeizures: Array<{
    symbol: string;
    amount: number;
    valueUSD: number;
    method?: 'usdc' | 'cc';
    error?: string;
  }>;
  cantonBridges: Array<{
    sourceChain: string;
    usdcAmount: string;
    valueUSD: number;
    swapTxHash?: string;
    error?: string;
  }>;
  seizedVaultAssets: Array<{ assetId: string; amount: number }>;
  errors: string[];
}

/** Internal inventory item for seizure planning */
interface InventoryItem {
  source: 'evm' | 'canton';
  type: string;       // 'ETH', 'USDC', 'CC', 'CUSDC'
  chain?: string;      // EVM chain name
  chainId?: number;    // EVM chain ID
  escrowAddress?: string;
  amountRaw: bigint | number; // wei for EVM, decimal for Canton
  valueUSD: number;
  priority: number;    // lower = seized first
}

/**
 * Execute full collateral seizure for an auto-liquidated position.
 *
 * Flow:
 * 1. Calculate liquidation amount (|PnL| capped at collateral value)
 * 2. Inventory all collateral sources (EVM escrows + Canton assets)
 * 3. Greedy waterfall: seize stablecoins first, then CC, then ETH
 * 4. Execute seizures (EVM tx + Splice transfer for each)
 */
export async function executeLiquidation(params: LiquidationParams): Promise<LiquidationResult> {
  const { env, position, vault, prices } = params;

  const result: LiquidationResult = {
    success: false,
    liquidationAmountUSD: 0,
    totalSeizedUSD: 0,
    escrowSeizures: [],
    cantonSeizures: [],
    cantonBridges: [],
    seizedVaultAssets: [],
    errors: [],
  };

  // Step 1: Calculate liquidation amount
  const liquidationAmountUSD = position.pnl < 0
    ? Math.min(Math.abs(position.pnl), position.collateralValue)
    : 0;

  if (liquidationAmountUSD <= 0) {
    result.success = true;
    console.log(`[Liquidation] Position ${position.positionId}: PnL >= 0, no seizure needed`);
    return result;
  }

  result.liquidationAmountUSD = liquidationAmountUSD;
  console.log(`[Liquidation] Position ${position.positionId}: seizing up to $${liquidationAmountUSD.toFixed(2)} (PnL: $${position.pnl.toFixed(2)})`);

  // Step 2: Get deployer/liquidator address from private key
  let deployerAddress: string;
  try {
    const rawKey = env.DEPLOYER_PRIVATE_KEY.trim();
    const privateKey = rawKey.startsWith('0x') ? rawKey as Hex : `0x${rawKey}` as Hex;
    const account = privateKeyToAccount(privateKey);
    deployerAddress = account.address;
  } catch (err) {
    result.errors.push(`Failed to derive deployer address: ${err}`);
    return result;
  }

  const isTestnet = (env.NETWORK_MODE || 'testnet') === 'testnet';
  const chainNameToId = isTestnet ? CHAIN_NAME_TO_ID_TESTNET : CHAIN_NAME_TO_ID_MAINNET;

  // Step 3: Phase 1 — Inventory
  const inventory: InventoryItem[] = [];

  // 3a. EVM escrow balances
  const chainVaults = parseChainVaults(vault.payload.chainVaults);
  for (const cv of chainVaults) {
    const chainId = chainNameToId[cv.chain];
    if (!chainId || !cv.address) continue;

    try {
      const balances = await fetchEscrowBalances(env, cv.address, chainId);

      if (balances.usdc > 0n) {
        // USDC has 6 decimals
        const usdcValue = Number(balances.usdc) / 1e6 * (prices['USDC'] || 1);
        inventory.push({
          source: 'evm',
          type: 'USDC',
          chain: cv.chain,
          chainId,
          escrowAddress: cv.address,
          amountRaw: balances.usdc,
          valueUSD: usdcValue,
          priority: 0,
        });
      }

      if (balances.eth > 0n) {
        // ETH has 18 decimals
        const ethValue = Number(balances.eth) / 1e18 * (prices['ETH'] || 3500);
        inventory.push({
          source: 'evm',
          type: 'ETH',
          chain: cv.chain,
          chainId,
          escrowAddress: cv.address,
          amountRaw: balances.eth,
          valueUSD: ethValue,
          priority: 3,
        });
      }
    } catch (err) {
      const msg = `Failed to read escrow balances for ${cv.chain} ${cv.address}: ${err}`;
      console.error(`[Liquidation] ${msg}`);
      result.errors.push(msg);
    }
  }

  // 3b. Canton-native assets from vault collateralAssets
  for (const asset of vault.payload.collateralAssets) {
    const amount = parseFloat(asset.amount) || 0;
    if (amount <= 0) continue;

    const symbolFromId = asset.assetId.split('-')[0];
    const symbol = symbolFromId.toUpperCase();

    if (symbol === 'USDC' || symbol === 'CUSDC' || symbol === 'CUSD') {
      const valueUSD = amount * (prices['USDC'] || 1);
      inventory.push({
        source: 'canton',
        type: symbol === 'CUSDC' ? 'CUSDC' : 'USDC_CANTON',
        amountRaw: amount,
        valueUSD,
        priority: symbol === 'CUSDC' ? 1 : 0,
      });
    } else if (symbol === 'CC') {
      const valueUSD = amount * (prices['CC'] || 0.5);
      inventory.push({
        source: 'canton',
        type: 'CC',
        amountRaw: amount,
        valueUSD,
        priority: 2,
      });
    }
    // Other Canton assets (non-CC, non-stablecoin) are not seizable
  }

  // Sort inventory by priority (stablecoins first, then CC, then ETH)
  inventory.sort((a, b) => a.priority - b.priority);

  console.log(`[Liquidation] Inventory: ${inventory.length} items, total value: $${inventory.reduce((s, i) => s + i.valueUSD, 0).toFixed(2)}`);

  // Step 4: Phase 2 — Plan (greedy waterfall)
  let remainingDebt = liquidationAmountUSD;
  const seizurePlan: Array<InventoryItem & { seizeValueUSD: number; seizeFraction: number }> = [];

  for (const item of inventory) {
    if (remainingDebt <= 0) break;

    const seizeValueUSD = Math.min(item.valueUSD, remainingDebt);
    const seizeFraction = item.valueUSD > 0 ? seizeValueUSD / item.valueUSD : 1;
    seizurePlan.push({ ...item, seizeValueUSD, seizeFraction });
    remainingDebt -= seizeValueUSD;
  }

  console.log(`[Liquidation] Plan: ${seizurePlan.length} seizures, remaining debt after plan: $${Math.max(0, remainingDebt).toFixed(2)}`);

  // Step 5: Phase 3 — Execute each planned seizure + bridge to Canton USDC
  for (const plan of seizurePlan) {
    if (plan.source === 'evm' && plan.type === 'USDC') {
      // EVM USDC: liquidateERC20 on escrow → deployer, then bridge to Canton USDC
      try {
        const usdcAddress = USDC_ADDRESSES[plan.chainId!];
        const seizeAmount = BigInt(Math.floor(Number(plan.amountRaw as bigint) * plan.seizeFraction));
        const callData = encodeLiquidateERC20(usdcAddress, deployerAddress, seizeAmount.toString());
        const { txHash } = await sendLiquidationTx(env, plan.escrowAddress!, callData, plan.chainId!);

        result.escrowSeizures.push({
          chain: plan.chain!,
          type: 'USDC',
          amountWei: seizeAmount.toString(),
          valueUSD: plan.seizeValueUSD,
          txHash,
        });
        result.totalSeizedUSD += plan.seizeValueUSD;
        console.log(`[Liquidation] EVM USDC seized: $${plan.seizeValueUSD.toFixed(2)} on ${plan.chain} (tx: ${txHash})`);

        // Bridge seized USDC to Canton via Stratos Swap router
        try {
          const { swapTxHash } = await bridgeToCantonUSDC(env, plan.chainId!, seizeAmount, position.broker);
          result.cantonBridges.push({
            sourceChain: plan.chain!,
            usdcAmount: seizeAmount.toString(),
            valueUSD: plan.seizeValueUSD,
            swapTxHash,
          });
          console.log(`[Liquidation] Bridged USDC to Canton for broker (tx: ${swapTxHash})`);
        } catch (bridgeErr) {
          const bridgeMsg = `Bridge to Canton failed for ${plan.chain} USDC: ${bridgeErr}`;
          console.error(`[Liquidation] ${bridgeMsg}`);
          result.errors.push(bridgeMsg);
          result.cantonBridges.push({
            sourceChain: plan.chain!,
            usdcAmount: seizeAmount.toString(),
            valueUSD: plan.seizeValueUSD,
            error: bridgeMsg,
          });
        }
      } catch (err) {
        const msg = `EVM USDC seizure failed on ${plan.chain}: ${err}`;
        console.error(`[Liquidation] ${msg}`);
        result.errors.push(msg);
        result.escrowSeizures.push({
          chain: plan.chain!,
          type: 'USDC',
          amountWei: '0',
          valueUSD: 0,
          error: msg,
        });
      }
    } else if (plan.source === 'evm' && plan.type === 'ETH') {
      // EVM ETH: liquidate (swap to USDC via Uniswap) → deployer, then bridge to Canton USDC
      try {
        // Check deployer USDC balance before (to compute exact bridge amount after swap)
        const usdcBefore = await getUSDCBalance(env, deployerAddress, plan.chainId!);

        const seizeAmount = BigInt(Math.floor(Number(plan.amountRaw as bigint) * plan.seizeFraction));
        // amountOutMin: 0 for testnet, 2% slippage for mainnet
        const amountOutMin = isTestnet ? 0n : BigInt(Math.floor(plan.seizeValueUSD * 0.98 * 1e6));
        const callData = encodeLiquidateETH(deployerAddress, seizeAmount.toString(), amountOutMin.toString());
        const { txHash } = await sendLiquidationTx(env, plan.escrowAddress!, callData, plan.chainId!);

        result.escrowSeizures.push({
          chain: plan.chain!,
          type: 'ETH',
          amountWei: seizeAmount.toString(),
          valueUSD: plan.seizeValueUSD,
          txHash,
        });
        result.totalSeizedUSD += plan.seizeValueUSD;
        console.log(`[Liquidation] EVM ETH seized: $${plan.seizeValueUSD.toFixed(2)} on ${plan.chain} (tx: ${txHash})`);

        // Bridge the USDC received from ETH→USDC swap to Canton
        try {
          // Compute exact USDC received from the Uniswap swap
          const usdcAfter = await getUSDCBalance(env, deployerAddress, plan.chainId!);
          const bridgeAmount = usdcAfter - usdcBefore;

          if (bridgeAmount > 0n) {
            const { swapTxHash } = await bridgeToCantonUSDC(env, plan.chainId!, bridgeAmount, position.broker);
            result.cantonBridges.push({
              sourceChain: plan.chain!,
              usdcAmount: bridgeAmount.toString(),
              valueUSD: Number(bridgeAmount) / 1e6,
              swapTxHash,
            });
            console.log(`[Liquidation] Bridged ${bridgeAmount} USDC (from ETH swap) to Canton for broker (tx: ${swapTxHash})`);
          } else {
            console.warn(`[Liquidation] No USDC balance increase after ETH liquidation on ${plan.chain}`);
          }
        } catch (bridgeErr) {
          const bridgeMsg = `Bridge to Canton failed for ${plan.chain} ETH→USDC: ${bridgeErr}`;
          console.error(`[Liquidation] ${bridgeMsg}`);
          result.errors.push(bridgeMsg);
          result.cantonBridges.push({
            sourceChain: plan.chain!,
            usdcAmount: '0',
            valueUSD: plan.seizeValueUSD,
            error: bridgeMsg,
          });
        }
      } catch (err) {
        const msg = `EVM ETH seizure failed on ${plan.chain}: ${err}`;
        console.error(`[Liquidation] ${msg}`);
        result.errors.push(msg);
        result.escrowSeizures.push({
          chain: plan.chain!,
          type: 'ETH',
          amountWei: '0',
          valueUSD: 0,
          error: msg,
        });
      }
    } else if (plan.source === 'canton') {
      // Canton CC/CUSDC: convert to Canton USDC and transfer to broker
      try {
        const seizeAmount = typeof plan.amountRaw === 'number'
          ? plan.amountRaw * plan.seizeFraction
          : Number(plan.amountRaw) * plan.seizeFraction;

        // Transfer Canton USDC from custodian to broker (falls back to CC if USDC unavailable)
        const transferResult = await transferCantonUSDCToBroker(
          env, position.broker, plan.seizeValueUSD, params.custodianParty || '',
        );

        result.cantonSeizures.push({
          symbol: plan.type,
          amount: seizeAmount,
          valueUSD: plan.seizeValueUSD,
          method: transferResult.method,
        });
        result.totalSeizedUSD += plan.seizeValueUSD;
        console.log(`[Liquidation] Canton ${plan.type} → ${transferResult.method.toUpperCase()}: ${seizeAmount.toFixed(4)} ($${plan.seizeValueUSD.toFixed(2)})`);

        if (transferResult.error) {
          result.errors.push(transferResult.error);
        }
      } catch (err) {
        const msg = `Canton ${plan.type} transfer failed: ${err}`;
        console.error(`[Liquidation] ${msg}`);
        result.errors.push(msg);
        result.cantonSeizures.push({
          symbol: plan.type,
          amount: 0,
          valueUSD: 0,
          error: msg,
        });
      }
    }
  }

  result.success = result.totalSeizedUSD > 0 || result.errors.length === 0;
  console.log(`[Liquidation] Position ${position.positionId}: seized $${result.totalSeizedUSD.toFixed(2)} / $${liquidationAmountUSD.toFixed(2)}, ${result.errors.length} errors`);

  // Build seizedVaultAssets by matching seized items back to vault assetId values
  // Map: uppercase symbol → vault assetId
  const symbolToVaultAssetId: Record<string, string> = {};
  for (const asset of vault.payload.collateralAssets) {
    const sym = asset.assetId.split('-')[0].toUpperCase();
    symbolToVaultAssetId[sym] = asset.assetId;
  }

  for (const plan of seizurePlan) {
    if (plan.seizeValueUSD <= 0) continue;
    // Determine the seized amount in asset units (not wei)
    let seizedAmount: number;
    let symbol: string;

    if (plan.source === 'evm' && plan.type === 'ETH') {
      seizedAmount = (Number(plan.amountRaw) / 1e18) * plan.seizeFraction;
      symbol = 'ETH';
    } else if (plan.source === 'evm' && plan.type === 'USDC') {
      seizedAmount = (Number(plan.amountRaw) / 1e6) * plan.seizeFraction;
      symbol = 'USDC';
    } else if (plan.source === 'canton') {
      seizedAmount = (typeof plan.amountRaw === 'number' ? plan.amountRaw : Number(plan.amountRaw)) * plan.seizeFraction;
      symbol = plan.type === 'CC' ? 'CC' : plan.type === 'CUSDC' ? 'CUSDC' : 'USDC';
    } else {
      continue;
    }

    const vaultAssetId = symbolToVaultAssetId[symbol];
    if (vaultAssetId && seizedAmount > 0) {
      result.seizedVaultAssets.push({ assetId: vaultAssetId, amount: seizedAmount });
    }
  }

  return result;
}
