/**
 * PrivaMargin API Service
 *
 * Uses SDK's Canton methods for contract operations when available,
 * falls back to mock data for demo/development purposes.
 */

import { getSDK } from '@stratos-wallet/sdk';
import type { CantonContract } from '@stratos-wallet/sdk';
import {
  deployEscrowContract, deployDepositRelay,
  encodeWithdrawETH, encodeWithdrawERC20, encodeLiquidateETH, encodeLiquidateERC20,
  encodeForwardETH, encodeForwardERC20,
  CHAIN_CONFIG, CHAIN_NAME_TO_ID, CHAIN_ID_TO_NAME,
  getDefaultChainId, getNetworkMode, isEVMChain,
} from './evmEscrow';

// Truncate a number to 10 decimal places for Daml Numeric 10
function toDecimal10(n: number): string {
  const s = n.toFixed(10);
  return s.replace(/\.?0+$/, '') || '0';
}

// CPCV Package ID (deterministic hash - same across all participant nodes)
// Must match the DAR file: daml/.daml/dist/privamargin8-0.1.0.dar
const CPCV_PACKAGE_ID = '04e4abfad9464293823d9f7d6c0d4373ce4ddfbb7abe92bfbf06c87a9a733a53';

// Template IDs for PrivaMargin Daml contracts (from cpcv-hackathon)
// Format: PackageId:ModuleName:TemplateName
const TEMPLATE_IDS = {
  VAULT: `${CPCV_PACKAGE_ID}:CollateralVault:CollateralVault`,
  MARGIN_REQUIREMENT: `${CPCV_PACKAGE_ID}:MarginVerification:MarginRequirement`,
  MARGIN_CALL: `${CPCV_PACKAGE_ID}:MarginVerification:MarginCall`,
  SETTLEMENT: `${CPCV_PACKAGE_ID}:MarginVerification:Settlement`,
  TOKENIZED_ASSET: `${CPCV_PACKAGE_ID}:Assets:TokenizedAsset`,
  ASSET_ISSUANCE: `${CPCV_PACKAGE_ID}:Assets:AssetIssuance`,
  // Role templates
  OPERATOR_ROLE: `${CPCV_PACKAGE_ID}:Roles:OperatorRole`,
  BROKER_ROLE: `${CPCV_PACKAGE_ID}:Roles:BrokerRole`,
  ROLE_ASSIGNMENT: `${CPCV_PACKAGE_ID}:Roles:RoleAssignment`,
  // Broker-Fund Link templates
  BROKER_FUND_INVITATION: `${CPCV_PACKAGE_ID}:BrokerFundLink:BrokerFundInvitation`,
  BROKER_FUND_LINK: `${CPCV_PACKAGE_ID}:BrokerFundLink:BrokerFundLink`,
  // LTV Change Proposal template
  LTV_CHANGE_PROPOSAL: `${CPCV_PACKAGE_ID}:BrokerFundLink:LTVChangeProposal`,
  // Position template
  POSITION: `${CPCV_PACKAGE_ID}:Position:Position`,
  // Workflow margin call
  WORKFLOW_MARGIN_CALL: `${CPCV_PACKAGE_ID}:MarginVerification:WorkflowMarginCall`,
  // Collateral lock (self-custodied CC pledge)
  COLLATERAL_LOCK: `${CPCV_PACKAGE_ID}:CollateralLock:CollateralLock`,
};

// Choice names
const CHOICES = {
  // CollateralVault choices
  DEPOSIT_ASSET: 'DepositAsset',
  DEPOSIT_ASSET_WITH_TX: 'DepositAssetWithTx',
  WITHDRAW_ASSET: 'WithdrawAsset',
  LINK_TO_POSITION: 'LinkToPosition',
  REGISTER_CHAIN_VAULT: 'RegisterChainVault',
  RECORD_DEPOSIT: 'RecordDeposit',
  GET_VAULT_VALUE: 'GetVaultValue',
  GET_VAULT_INFO: 'GetVaultInfo',
  CLOSE_VAULT: 'CloseVault',
  SEIZE_COLLATERAL: 'SeizeCollateral',
  // MarginRequirement choices
  VERIFY_MARGIN: 'VerifyMargin',
  TRIGGER_MARGIN_CALL: 'TriggerMarginCall',
  // MarginCall choices
  SETTLE_MARGIN_CALL: 'SettleMarginCall',
  CANCEL_MARGIN_CALL: 'CancelMarginCall',
  // Asset choices
  TRANSFER: 'Transfer',
  UPDATE_VALUE: 'UpdateValue',
  ACCEPT: 'Accept',
  // Role choices
  ASSIGN_PRIME_BROKER: 'AssignPrimeBroker',
  ASSIGN_FUND: 'AssignFund',
  BROKER_ASSIGN_FUND: 'BrokerAssignFund',
  REVOKE_ROLE: 'RevokeRole',
  // BrokerFundLink choices
  ACCEPT_INVITATION: 'AcceptInvitation',
  REJECT_INVITATION: 'RejectInvitation',
  SET_LTV_THRESHOLD: 'SetLTVThreshold',
  SET_LEVERAGE_RATIO: 'SetLeverageRatio',
  DEACTIVATE_LINK: 'DeactivateLink',
  PROPOSE_LTV_CHANGE: 'ProposeLTVChange',
  // BrokerFundLink allowed assets / collaterals
  UPDATE_ALLOWED_ASSETS: 'UpdateAllowedAssets',
  UPDATE_ALLOWED_COLLATERALS: 'UpdateAllowedCollaterals',
  // LTVChangeProposal choices
  ACCEPT_PROPOSAL: 'AcceptProposal',
  REJECT_PROPOSAL: 'RejectProposal',
  // Position choices
  UPDATE_LTV: 'UpdateLTV',
  MARK_MARGIN_CALLED: 'MarkMarginCalled',
  CLOSE_POSITION: 'ClosePosition',
  LIQUIDATE_POSITION: 'LiquidatePosition',
  ATTEST_COLLATERAL: 'AttestCollateral',
  // WorkflowMarginCall choices
  ACKNOWLEDGE_MARGIN_CALL: 'AcknowledgeMarginCall',
  RESOLVE_MARGIN_CALL: 'ResolveMarginCall',
};

// Interfaces
interface CollateralAsset {
  assetId: string;
  assetType: string;
  amount: number;
  valueUSD: number;
}

interface Vault {
  vaultId: string;
  owner: string;
  collateralAssets: CollateralAsset[];
  totalValue: number;
  linkedPositions: string[];
  chainVaults: Array<{ chain: string; custodyAddress: string }>;
  depositRecords: Array<{ txId: string; chain: string; symbol: string; amount: string }>;
  chainBalancesBySymbol: Record<string, Record<string, number>>;
  createdAt: string;
}

interface MarginCall {
  id: string;
  positionId: string;
  requiredAmount: number;
  provider: string;
  counterparty: string;
  status: 'Active' | 'Settled' | 'Cancelled';
  createdAt: string;
}

interface VerificationResult {
  status: 'Sufficient' | 'Insufficient';
  ltv: number;
  ltvBps: number;
  timestamp: string;
  zkProof?: {
    proof: unknown;
    publicSignals: string[];
    proofHash: string;
    isLiquidatable: boolean;
    proofTimeMs: number;
    verified: boolean;
  };
}

// Map UI asset type strings to Daml AssetType enum
// Canton JSON API expects simple string for enums
function mapAssetTypeToEnum(assetType: string): string {
  if (assetType === 'USDC' || assetType === 'USDT' || assetType === 'CUSD' || assetType === 'CUSDC') {
    return 'Stablecoin';
  }
  if (assetType === 'CC') {
    return 'CantonCoin';
  }
  // BTC, ETH, SOL, TRX, TON are all crypto
  return 'Cryptocurrency';
}

// Fallback asset prices — updated Feb 2026 (used only when CoinGecko is unreachable)
const FALLBACK_PRICES: Record<string, number> = {
  'BTC': 68000,
  'ETH': 2050,
  'SOL': 88,
  'CC': 0.158,
  'USDC': 1,
  'USDT': 1,
  'TRX': 0.25,
  'TON': 5.50,
  'CUSD': 1,
  'CUSDC': 1,
};

// CoinGecko ID mapping (matches wallet SDK priceService.ts)
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  CC: 'canton-network',
  USDC: 'usd-coin',
  USDT: 'tether',
  TRX: 'tron',
  TON: 'the-open-network',
  // CUSD has no CoinGecko listing — pegged to $1
};

// Live price cache
let livePriceCache: Record<string, number> = {};
let livePriceCacheTime = 0;
let livePricesAreFresh = false; // true when CoinGecko responded successfully
const PRICE_CACHE_TTL = 60_000; // 1 minute

// Fetch live prices directly from CoinGecko (same source as wallet SDK)
async function fetchLivePrices(): Promise<Record<string, number>> {
  const now = Date.now();
  if (now - livePriceCacheTime < PRICE_CACHE_TTL && Object.keys(livePriceCache).length > 0) {
    return livePriceCache;
  }
  try {
    const ids = Object.values(COINGECKO_IDS).join(',');
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
    );
    const data = await res.json() as Record<string, { usd?: number }>;

    const prices: Record<string, number> = { ...FALLBACK_PRICES };
    let gotLive = false;
    for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
      if (data[geckoId]?.usd) {
        prices[symbol] = data[geckoId].usd;
        gotLive = true;
      }
    }
    livePriceCache = prices;
    livePriceCacheTime = now;
    livePricesAreFresh = gotLive;
    return livePriceCache;
  } catch (err) {
    console.warn('Failed to fetch live prices from CoinGecko, using fallback:', err);
  }
  livePricesAreFresh = false;
  return FALLBACK_PRICES;
}

// Map internal symbol to user-facing display name (e.g. CUSDC → USDC)
const DISPLAY_SYMBOLS: Record<string, string> = {
  'CUSDC': 'USDC (Canton)',
};
export function displaySymbol(symbol: string): string {
  return DISPLAY_SYMBOLS[symbol] || symbol;
}

// Get live price for a symbol
export async function getLivePrice(symbol: string): Promise<number> {
  const prices = await fetchLivePrices();
  return prices[symbol] || FALLBACK_PRICES[symbol] || 1;
}

// Returns true if the most recent fetchLivePrices got real CoinGecko data (not stale fallback)
export function arePricesFresh(): boolean {
  return livePricesAreFresh;
}

// Fetch recent price history for an asset from CoinGecko
export async function getAssetPriceHistory(
  symbol: string,
  days: number = 7,
): Promise<Array<{ time: number; price: number }>> {
  const geckoId = COINGECKO_IDS[symbol];
  if (!geckoId) return [];
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${geckoId}/market_chart?vs_currency=usd&days=${days}`,
    );
    const data = await res.json() as { prices?: Array<[number, number]> };
    if (!data.prices) return [];
    return data.prices.map(([time, price]) => ({ time, price }));
  } catch (err) {
    console.warn('Failed to fetch price history from CoinGecko:', err);
    return [];
  }
}

// Mock data storage (fallback when Canton is not available)
let mockVaults: Map<string, Vault> = new Map();
let mockMarginCalls: Map<string, MarginCall> = new Map();
let mockVerifications: Map<string, VerificationResult> = new Map();

// Check if we're in iframe with SDK access
const isInIframe = window.parent !== window;

// Get SDK instance
const sdk = isInIframe ? getSDK() : null;

// Cached operator party (fetched from /api/config)
let cachedOperatorParty: string | null = null;

export async function getOperatorParty(): Promise<string | null> {
  if (cachedOperatorParty) return cachedOperatorParty;
  try {
    const res = await fetch('/api/config');
    const data = await res.json() as { operatorParty?: string };
    cachedOperatorParty = data.operatorParty || null;
    return cachedOperatorParty;
  } catch {
    return null;
  }
}

// Cached custodian party (fetched from /api/config)
let cachedCustodianParty: string | null = null;
let custodianPartyFetched = false;

export async function getCustodianParty(): Promise<string | null> {
  if (custodianPartyFetched) return cachedCustodianParty;
  try {
    const res = await fetch('/api/config');
    const data = await res.json() as { custodianParty?: string };
    cachedCustodianParty = data.custodianParty || null;
    custodianPartyFetched = true;
    return cachedCustodianParty;
  } catch {
    return null;
  }
}

// Resolve the actual asset symbol from assetId (e.g. "BTC-1706123456789-abc123" → "BTC")
// Falls back to enum mapping if assetId is missing or symbol is unrecognised
function resolveAssetSymbol(assetTypeEnum: string, assetId: string): string {
  if (assetId) {
    const parts = assetId.split('-');
    const symbolParts: string[] = [];
    for (const part of parts) {
      if (/^\d{10,}$/.test(part)) break;
      symbolParts.push(part);
    }
    if (symbolParts.length > 0) {
      const symbol = symbolParts.join('-');
      if (FALLBACK_PRICES[symbol] !== undefined) return symbol;
    }
  }
  switch (assetTypeEnum) {
    case 'Stablecoin': return 'USDC';
    case 'CantonCoin': return 'CC';
    case 'Cryptocurrency': return 'ETH';
    default: return assetTypeEnum;
  }
}

// Transform Canton contract to Vault (uses on-chain valueUSD as initial)
function contractToVault(contract: CantonContract<Record<string, unknown>>): Vault {
  const payload = contract.payload;

  // Transform collateral assets from Canton format, aggregating by symbol
  const rawAssets = (payload.collateralAssets as Array<Record<string, unknown>>) || [];
  const assetMap = new Map<string, CollateralAsset>();
  for (const asset of rawAssets) {
    const amount = typeof asset.amount === 'string' ? parseFloat(asset.amount) : (asset.amount as number) || 0;
    const valueUSD = typeof asset.valueUSD === 'string' ? parseFloat(asset.valueUSD) : (asset.valueUSD as number) || 0;
    const symbol = resolveAssetSymbol(asset.assetType as string, asset.assetId as string);

    const existing = assetMap.get(symbol);
    if (existing) {
      existing.amount += amount;
      existing.valueUSD += valueUSD;
    } else {
      assetMap.set(symbol, {
        assetId: asset.assetId as string,
        assetType: symbol,
        amount,
        valueUSD,
      });
    }
  }
  const collateralAssets = Array.from(assetMap.values());

  // Calculate total value from assets
  const totalValue = collateralAssets.reduce((sum, asset) => sum + asset.valueUSD, 0);

  // Parse Optional [(Text, Text)] chainVaults
  // Canton JSON API may encode tuples as arrays or objects, and Optional adds wrapping
  const chainVaults = parseOptionalTupleList(payload.chainVaults, 2).map(t => ({
    chain: t[0] || '', custodyAddress: t[1] || '',
  }));

  // Parse Optional [(Text, Text, Text, Text)] depositRecords
  const depositRecords = parseOptionalTupleList(payload.depositRecords, 4).map(t => ({
    txId: t[0] || '', chain: t[1] || '', symbol: t[2] || '', amount: t[3] || '',
  }));

  // Derive per-chain balances from depositRecords: { symbol → { chain → sum(amount) } }
  // depositRecords may store Daml enum names ("Stablecoin") or resolved symbols ("USDC"),
  // so normalize via resolveAssetSymbol to match collateralAssets keys.
  // Also normalize chain names: 'canton'→'Canton', 'evm'→specific chain if single EVM escrow.
  const evmChainVaults = chainVaults.filter(cv => isEVMChain(cv.chain));
  const chainBalancesBySymbol: Record<string, Record<string, number>> = {};
  for (const dr of depositRecords) {
    if (!dr.symbol || !dr.chain) continue;
    const symbol = resolveAssetSymbol(dr.symbol, '');
    // Normalize chain name to prevent double-counting (e.g. 'evm' + 'Base' for same deposit)
    let chain = dr.chain;
    if (chain.toLowerCase() === 'canton') {
      chain = 'Canton';
    } else if (chain === 'evm' && evmChainVaults.length === 1) {
      chain = evmChainVaults[0].chain;
    }
    if (!chainBalancesBySymbol[symbol]) chainBalancesBySymbol[symbol] = {};
    chainBalancesBySymbol[symbol][chain] = (chainBalancesBySymbol[symbol][chain] || 0) + (parseFloat(dr.amount) || 0);
  }

  return {
    vaultId: payload.vaultId as string,
    owner: payload.owner as string,
    collateralAssets,
    totalValue,
    linkedPositions: (payload.linkedPositions as string[]) || [],
    chainVaults,
    depositRecords,
    chainBalancesBySymbol,
    createdAt: contract.createdAt || new Date().toISOString(),
  };
}

// Recalculate vault asset values using live prices (replaces stale on-chain valueUSD)
async function recalcVaultPrices(vault: Vault): Promise<Vault> {
  const prices = await fetchLivePrices();
  const updatedAssets = vault.collateralAssets.map(asset => {
    const livePrice = prices[asset.assetType] || FALLBACK_PRICES[asset.assetType] || 1;
    return { ...asset, valueUSD: asset.amount * livePrice };
  });
  return {
    ...vault,
    collateralAssets: updatedAssets,
    totalValue: updatedAssets.reduce((sum, a) => sum + a.valueUSD, 0),
  };
}

// Transform Canton contract to MarginCall
function contractToMarginCall(contract: CantonContract<Record<string, unknown>>): MarginCall {
  const payload = contract.payload;
  return {
    id: contract.contractId,
    positionId: payload.positionId as string,
    requiredAmount: payload.requiredAmount as number,
    provider: payload.provider as string,
    counterparty: payload.counterparty as string,
    status: (payload.status as 'Active' | 'Settled' | 'Cancelled') || 'Active',
    createdAt: contract.createdAt || new Date().toISOString(),
  };
}

// Helper: mint a TokenizedAsset and deposit it into a vault (used by sync flow)
async function mintAndDeposit(
  vaultId: string, owner: string,
  symbol: string, amount: number, price: number, chain: string,
) {
  if (!sdk) throw new Error('SDK not available');

  const assetId = `${symbol}-sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const assetTypeEnum = mapAssetTypeToEnum(symbol);
  const valueUSD = amount * price;

  // Mint TokenizedAsset via AssetIssuance
  const issuanceResult = await sdk.cantonCreate({
    templateId: TEMPLATE_IDS.ASSET_ISSUANCE,
    payload: {
      issuer: owner,
      recipient: owner,
      assetId,
      assetType: assetTypeEnum,
      amount: toDecimal10(amount),
      valueUSD: toDecimal10(valueUSD),
    },
  });
  const acceptResult = await sdk.cantonExercise({
    contractId: issuanceResult.contractId,
    templateId: TEMPLATE_IDS.ASSET_ISSUANCE,
    choice: 'Accept',
    argument: {},
  });
  const tokenizedAssetCid = acceptResult.events?.find(
    (e: { templateId: string }) => e.templateId.includes('TokenizedAsset')
  )?.contractId;
  if (!tokenizedAssetCid) throw new Error('Failed to create TokenizedAsset for sync');

  // Deposit into vault (re-query to get fresh contract ID)
  const vaults = await sdk.cantonQuery({
    templateId: TEMPLATE_IDS.VAULT,
    filter: { vaultId },
  });
  if (vaults.length === 0) throw new Error('Vault not found for sync deposit');

  await sdk.cantonExercise({
    contractId: vaults[0].contractId,
    templateId: TEMPLATE_IDS.VAULT,
    choice: 'DepositAssetWithTx',
    argument: {
      assetCid: tokenizedAssetCid,
      txId: 'external-deposit',
      chain,
    },
  });

  console.log(`[syncEscrow] Deposited ${amount} ${symbol} from ${chain} into vault ${vaultId}`);
}

// Vault API
export const vaultAPI = {
  create: async (owner: string, vaultId: string, initialAssets?: Array<{ assetType: string; amount: number }>) => {
    // Try SDK first
    if (sdk) {
      try {
        // Use dedicated custodian party for vault custody; fallback to operator or owner
        const operatorParty = await getCustodianParty() || await getOperatorParty() || owner;

        // Step 1: Create the vault (owner is sole signatory, operator is observer)
        const result = await sdk.cantonCreate({
          templateId: TEMPLATE_IDS.VAULT,
          payload: {
            vaultId,
            owner,
            operator: operatorParty,
            collateralAssets: [],
            linkedPositions: [],
            chainVaults: null,
            depositRecords: null,
          },
        });
        console.log('Created vault:', result.contractId);

        // Step 2: If initial assets provided, mint them and deposit into vault
        if (initialAssets && initialAssets.length > 0) {
          let vaultContractId = result.contractId;
          const livePrices = await fetchLivePrices();

          for (const asset of initialAssets) {
            const assetId = `${asset.assetType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const price = livePrices[asset.assetType] || FALLBACK_PRICES[asset.assetType] || 1;
            const valueUSD = asset.amount * price;
            const assetTypeEnum = mapAssetTypeToEnum(asset.assetType);

            // Create AssetIssuance
            const issuanceResult = await sdk.cantonCreate({
              templateId: TEMPLATE_IDS.ASSET_ISSUANCE,
              payload: {
                issuer: owner,
                recipient: owner,
                assetId,
                assetType: assetTypeEnum,
                amount: toDecimal10(asset.amount),
                valueUSD: toDecimal10(valueUSD)
              }
            });
            console.log('Created AssetIssuance:', issuanceResult.contractId);

            // Accept to create TokenizedAsset
            const acceptResult = await sdk.cantonExercise({
              contractId: issuanceResult.contractId,
              templateId: TEMPLATE_IDS.ASSET_ISSUANCE,
              choice: CHOICES.ACCEPT,
              argument: {}
            });

            const tokenizedAssetCid = acceptResult.events?.find(
              (e: { templateId: string }) => e.templateId.includes('TokenizedAsset')
            )?.contractId;

            if (!tokenizedAssetCid) {
              throw new Error('Failed to create TokenizedAsset');
            }
            console.log('Created TokenizedAsset:', tokenizedAssetCid);

            // Deposit into vault (this archives old vault and creates new one)
            const depositResult = await sdk.cantonExercise({
              contractId: vaultContractId,
              templateId: TEMPLATE_IDS.VAULT,
              choice: CHOICES.DEPOSIT_ASSET,
              argument: { assetCid: tokenizedAssetCid }
            });
            console.log('Deposited asset into vault');

            // Get the new vault contract ID from the deposit result
            const newVaultCid = depositResult.events?.find(
              (e: { templateId: string }) => e.templateId.includes('CollateralVault')
            )?.contractId;
            if (newVaultCid) {
              vaultContractId = newVaultCid;
            }
          }
        }

        return { data: { vaultId, owner, contractId: result.contractId } };
      } catch (error) {
        console.warn('Canton create failed, using mock:', error);
      }
    }

    // Fallback to mock
    const vault: Vault = {
      vaultId,
      owner,
      collateralAssets: [],
      totalValue: 0,
      linkedPositions: [],
      chainVaults: [],
      depositRecords: [],
      chainBalancesBySymbol: {},
      createdAt: new Date().toISOString(),
    };
    mockVaults.set(vaultId, vault);
    return { data: vault };
  },

  // Mint a new TokenizedAsset for the user (separate from deposit)
  mintAsset: async (owner: string, assetType: string, amount: number) => {
    if (sdk) {
      try {
        const assetId = `${assetType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const livePrices = await fetchLivePrices();
        const price = livePrices[assetType] || FALLBACK_PRICES[assetType] || 1;
        const valueUSD = amount * price;
        const assetTypeEnum = mapAssetTypeToEnum(assetType);

        // Create AssetIssuance
        const issuanceResult = await sdk.cantonCreate({
          templateId: TEMPLATE_IDS.ASSET_ISSUANCE,
          payload: {
            issuer: owner,
            recipient: owner,
            assetId,
            assetType: assetTypeEnum,
            amount: toDecimal10(amount),
            valueUSD: toDecimal10(valueUSD)
          }
        });

        // Accept to create TokenizedAsset
        const acceptResult = await sdk.cantonExercise({
          contractId: issuanceResult.contractId,
          templateId: TEMPLATE_IDS.ASSET_ISSUANCE,
          choice: CHOICES.ACCEPT,
          argument: {}
        });

        const tokenizedAssetCid = acceptResult.events?.find(
          (e: { templateId: string }) => e.templateId.includes('TokenizedAsset')
        )?.contractId;

        if (!tokenizedAssetCid) {
          throw new Error('Failed to create TokenizedAsset');
        }

        return { data: { contractId: tokenizedAssetCid, assetId, assetType, amount, valueUSD } };
      } catch (error) {
        console.warn('Canton mint failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },

  // Get user's available TokenizedAssets (not yet deposited in a vault)
  getAvailableAssets: async (owner: string) => {
    if (sdk) {
      try {
        const assets = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.TOKENIZED_ASSET,
          filter: { owner }
        });
        return { data: assets.map(a => ({
          contractId: a.contractId,
          assetId: (a.payload as Record<string, unknown>).assetId as string,
          assetType: (a.payload as Record<string, unknown>).assetType as string,
          amount: parseFloat((a.payload as Record<string, unknown>).amount as string),
          valueUSD: parseFloat((a.payload as Record<string, unknown>).valueUSD as string),
        })) };
      } catch (error) {
        console.warn('Canton query failed:', error);
      }
    }
    return { data: [] };
  },

  deposit: async (vaultId: string, assetContractId: string) => {
    // Try SDK first - deposit an existing TokenizedAsset
    if (sdk) {
      try {
        // Query the vault contract
        const vaults = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.VAULT,
          filter: { vaultId }
        });

        if (vaults.length > 0) {
          const vaultContract = vaults[0];

          // Exercise DepositAsset with the existing TokenizedAsset contract ID
          await sdk.cantonExercise({
            contractId: vaultContract.contractId,
            templateId: TEMPLATE_IDS.VAULT,
            choice: CHOICES.DEPOSIT_ASSET,
            argument: { assetCid: assetContractId }
          });
          console.log('Deposited asset into vault');

          // Query updated vault
          const updatedVaults = await sdk.cantonQuery({
            templateId: TEMPLATE_IDS.VAULT,
            filter: { vaultId }
          });
          if (updatedVaults.length > 0) {
            return { data: await recalcVaultPrices(contractToVault(updatedVaults[0])) };
          }
        }
      } catch (error) {
        console.warn('Canton deposit failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available or vault not found');
  },

  // Real deposit: transfers tokens from wallet via SDK, then records in Daml vault
  depositReal: async (vaultId: string, symbol: string, amount: number, chain: string, chainName?: string) => {
    if (!sdk) throw new Error('SDK not available');

    // chain = routing type ('evm', 'canton')
    // chainName = specific chain name ('Ethereum', 'Base', 'Canton') for the deposit record
    const recordChain = chainName || chain;

    // Query vault first to get owner/operator
    const vaults = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.VAULT,
      filter: { vaultId }
    });
    if (vaults.length === 0) throw new Error('Vault not found');
    const vaultContract = vaults[0];
    const owner = (vaultContract.payload as Record<string, unknown>).owner as string;
    const operator = (vaultContract.payload as Record<string, unknown>).operator as string;

    // Step 1: Real transfer — route based on chain type
    // If vault has an EVM escrow registered for this chain, send directly to escrow contract
    // Otherwise use Canton custodian party transfer
    const vault = contractToVault(vaultContract);
    // Match specific chain escrow first, then fall back to any EVM escrow
    const matchingEscrow = vault.chainVaults.find(cv =>
      chainName ? cv.chain === chainName : (isEVMChain(cv.chain) && chain === 'evm')
    );

    let txId: string | undefined;
    if (matchingEscrow && chain === 'evm') {
      // EVM path: send directly to escrow contract
      const chainId = CHAIN_NAME_TO_ID[matchingEscrow.chain] || getDefaultChainId();
      const isStablecoin = ['USDC', 'USDT'].includes(symbol);

      if (isStablecoin) {
        // ERC20 deposit: call transfer(escrowAddress, amount) on the token contract
        const decimals = symbol === 'USDC' || symbol === 'USDT' ? 6 : 18;
        const tokenAmount = BigInt(Math.round(amount * 10 ** decimals));
        const chainConfig = CHAIN_CONFIG[chainId];
        const tokenAddr = chainConfig?.usdc;
        if (!tokenAddr) throw new Error(`No ${symbol} token address for chain ${chainId}`);
        // ERC20 transfer(address,uint256) selector: 0xa9059cbb
        const paddedTo = matchingEscrow.custodyAddress.slice(2).toLowerCase().padStart(64, '0');
        const paddedAmount = tokenAmount.toString(16).padStart(64, '0');
        const callData = '0xa9059cbb' + paddedTo + paddedAmount;
        const evmResult = await sdk.sendContractCall(tokenAddr, callData, chainId);
        console.log('ERC20 escrow deposit result:', evmResult);
        txId = evmResult.transactionHash;
      } else {
        // Native ETH deposit: send value directly
        const amountWei = '0x' + BigInt(Math.round(amount * 1e18)).toString(16);
        const evmResult = await sdk.sendEVMTransaction({
          transaction: {
            to: matchingEscrow.custodyAddress,
            value: amountWei,
            chainId,
          },
        });
        console.log('EVM escrow deposit result:', evmResult);
        txId = evmResult.transactionHash;
      }
    } else {
      // Canton path: transfer CC to custodian + create CollateralLock
      // Step 1a: Actually move CC to custodian party (real balance transfer)
      const custodianParty = await getCustodianParty() || operator;
      const transferResult = await sdk.transfer({
        to: custodianParty,
        amount: amount.toString(),
        symbol,
        chain: chain as 'canton' | 'evm' | 'svm' | 'btc' | 'tron' | 'ton',
      });
      console.log('CC transfer to custodian:', transferResult);
      txId = (transferResult as { txId?: string }).txId;

      // Step 1a.2: Accept the transfer offer on the custodian's behalf
      // sdk.transfer() creates an offer; the custodian must accept for CC to actually move
      const transferContractId = (transferResult as { contractId?: string; offer_contract_id?: string }).contractId
        || (transferResult as { offer_contract_id?: string }).offer_contract_id;
      try {
        const acceptRes = await fetch('/api/custodian/accept-deposit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(transferContractId ? { contractId: transferContractId } : {}),
        });
        const acceptData = await acceptRes.json();
        console.log('Custodian accept-deposit result:', acceptData);
        if (!acceptRes.ok) {
          console.warn('Custodian accept-deposit failed:', acceptData);
        }
      } catch (acceptErr) {
        console.warn('Custodian accept-deposit error (non-fatal):', acceptErr);
      }

      // Step 1b: Create CollateralLock on Daml (records the encumbrance, gated release)
      const lockId = `lock-${vaultId}-${symbol}-${Date.now()}`;
      const livePricesForLock = await fetchLivePrices();
      const lockPrice = livePricesForLock[symbol] || FALLBACK_PRICES[symbol] || 1;
      await sdk.cantonCreate({
        templateId: TEMPLATE_IDS.COLLATERAL_LOCK,
        payload: {
          owner,
          operator,
          vaultId,
          assetType: mapAssetTypeToEnum(symbol),
          symbol,
          amount: toDecimal10(amount),
          valueUSD: toDecimal10(amount * lockPrice),
          lockId,
        },
      });
      console.log('CollateralLock created for vault', vaultId);
    }

    // Step 2: Mint TokenizedAsset on Daml (to record in vault)
    const assetId = `${symbol}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const livePrices = await fetchLivePrices();
    const price = livePrices[symbol] || FALLBACK_PRICES[symbol] || 1;
    const valueUSD = amount * price;
    const assetTypeEnum = mapAssetTypeToEnum(symbol);

    // Create and accept TokenizedAsset
    const issuanceResult = await sdk.cantonCreate({
      templateId: TEMPLATE_IDS.ASSET_ISSUANCE,
      payload: {
        issuer: owner,
        recipient: owner,
        assetId,
        assetType: assetTypeEnum,
        amount: toDecimal10(amount),
        valueUSD: toDecimal10(valueUSD),
      }
    });
    const acceptResult = await sdk.cantonExercise({
      contractId: issuanceResult.contractId,
      templateId: TEMPLATE_IDS.ASSET_ISSUANCE,
      choice: CHOICES.ACCEPT,
      argument: {}
    });
    const tokenizedAssetCid = acceptResult.events?.find(
      (e: { templateId: string }) => e.templateId.includes('TokenizedAsset')
    )?.contractId;
    if (!tokenizedAssetCid) throw new Error('Failed to create TokenizedAsset');

    // Step 3: Deposit into vault with tx tracking
    await sdk.cantonExercise({
      contractId: vaultContract.contractId,
      templateId: TEMPLATE_IDS.VAULT,
      choice: CHOICES.DEPOSIT_ASSET_WITH_TX,
      argument: {
        assetCid: tokenizedAssetCid,
        txId: txId || null,
        chain: recordChain,
      }
    });

    // Return updated vault
    const updatedVaults = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.VAULT,
      filter: { vaultId }
    });
    if (updatedVaults.length > 0) {
      return {
        data: await recalcVaultPrices(contractToVault(updatedVaults[0])),
        txId,
      };
    }
    throw new Error('Vault query failed after deposit');
  },

  // Legacy deposit that mints and deposits in one step (for backwards compatibility)
  depositNew: async (vaultId: string, assetId: string, assetType: string, amount: number) => {
    const prices = await fetchLivePrices();
    const price = prices[assetType] || FALLBACK_PRICES[assetType] || 1;
    const valueUSD = amount * price;

    if (sdk) {
      try {
        // Query the vault contract first
        const vaults = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.VAULT,
          filter: { vaultId }
        });

        if (vaults.length > 0) {
          const vaultContract = vaults[0];
          const owner = (vaultContract.payload as Record<string, unknown>).owner as string;
          const assetTypeEnum = mapAssetTypeToEnum(assetType);

          // Create AssetIssuance
          const issuanceResult = await sdk.cantonCreate({
            templateId: TEMPLATE_IDS.ASSET_ISSUANCE,
            payload: {
              issuer: owner,
              recipient: owner,
              assetId,
              assetType: assetTypeEnum,
              amount: toDecimal10(amount),
              valueUSD: toDecimal10(valueUSD)
            }
          });

          // Accept to create TokenizedAsset
          const acceptResult = await sdk.cantonExercise({
            contractId: issuanceResult.contractId,
            templateId: TEMPLATE_IDS.ASSET_ISSUANCE,
            choice: CHOICES.ACCEPT,
            argument: {}
          });

          const tokenizedAssetCid = acceptResult.events?.find(
            (e: { templateId: string }) => e.templateId.includes('TokenizedAsset')
          )?.contractId;

          if (!tokenizedAssetCid) {
            throw new Error('Failed to create TokenizedAsset');
          }

          // Deposit into vault
          await sdk.cantonExercise({
            contractId: vaultContract.contractId,
            templateId: TEMPLATE_IDS.VAULT,
            choice: CHOICES.DEPOSIT_ASSET,
            argument: { assetCid: tokenizedAssetCid }
          });

          // Query updated vault
          const updatedVaults = await sdk.cantonQuery({
            templateId: TEMPLATE_IDS.VAULT,
            filter: { vaultId }
          });
          if (updatedVaults.length > 0) {
            return { data: await recalcVaultPrices(contractToVault(updatedVaults[0])) };
          }
        }
      } catch (error) {
        console.warn('Canton deposit failed, using mock:', error);
      }
    }

    // Fallback to mock
    const vault = mockVaults.get(vaultId);
    if (!vault) throw new Error('Vault not found');

    vault.collateralAssets.push({ assetId, assetType, amount, valueUSD });
    vault.totalValue = vault.collateralAssets.reduce((sum, a) => sum + a.valueUSD, 0);

    return { data: vault };
  },

  getVault: async (vaultId: string) => {
    // Try SDK first
    if (sdk) {
      try {
        const vaults = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.VAULT,
          filter: { vaultId }
        });
        if (vaults.length > 0) {
          return { data: await recalcVaultPrices(contractToVault(vaults[0])) };
        }
        // Vault not found on Canton — don't fall back to mock
        throw new Error('Vault not found');
      } catch (error) {
        if (error instanceof Error && error.message === 'Vault not found') throw error;
        console.warn('Canton query failed, using mock:', error);
      }
    }

    // Fallback to mock (only when SDK is not available)
    const vault = mockVaults.get(vaultId);
    if (!vault) throw new Error('Vault not found');
    return { data: await recalcVaultPrices(vault) };
  },

  getByOwner: async (party: string) => {
    // Try SDK first
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.VAULT,
          filter: { owner: party }
        });
        const vaults = contracts.map(contractToVault);
        return { data: await Promise.all(vaults.map(recalcVaultPrices)) };
      } catch (error) {
        console.warn('Canton query failed, using mock:', error);
      }
    }

    const ownerVaults = Array.from(mockVaults.values()).filter(v => v.owner === party);
    return { data: await Promise.all(ownerVaults.map(recalcVaultPrices)) };
  },

  // Deploy an EVM escrow contract for a vault and register it on Canton.
  // Routes through the server-side deployer (/api/escrow/deploy) so escrow
  // contracts are deployed from a dedicated platform address for privacy.
  // Falls back to client-side SDK deploy if the server endpoint is unavailable.
  deployEVMEscrow: async (vaultId: string, chainId: number, liquidatorAddress?: string, displayChainName?: string) => {
    if (!sdk) throw new Error('SDK not available');

    // Resolve owner (fund party's EVM address)
    const addresses = await sdk.getAddresses();
    const evmAddr = addresses.find(a => a.chainType === 'evm');
    if (!evmAddr) throw new Error('No EVM address found');

    const ownerAddr = evmAddr.address;
    const liquidator = liquidatorAddress || ownerAddr;

    let contractAddress: string;
    let txHash: string;

    // Try server-side deployer first (dedicated platform address)
    try {
      const deployRes = await fetch('/api/escrow/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainId, ownerAddress: ownerAddr, liquidatorAddress: liquidator }),
      });
      const deployData = await deployRes.json() as {
        success?: boolean;
        contractAddress?: string;
        txHash?: string;
        error?: string;
      };
      if (deployRes.ok && deployData.success && deployData.contractAddress) {
        contractAddress = deployData.contractAddress;
        txHash = deployData.txHash || '';
        console.log('[EVM Escrow] Deployed via server-side deployer:', contractAddress);
      } else {
        throw new Error(deployData.error || 'Server deploy failed');
      }
    } catch (serverErr) {
      // Fallback: deploy from client wallet (user pays gas, traces to their address)
      console.warn('[EVM Escrow] Server deploy failed, falling back to client-side:', serverErr);
      const chainConfig = CHAIN_CONFIG[chainId];
      if (!chainConfig) throw new Error(`Unsupported chain ${chainId} — no Uniswap V3 config available`);
      const result = await deployEscrowContract(sdk, chainId, ownerAddr, liquidator, chainConfig.swapRouter, chainConfig.weth, chainConfig.usdc);
      contractAddress = result.contractAddress;
      txHash = result.txHash;
    }

    // Register the escrow address on the Daml vault via RegisterChainVault
    const vaults = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.VAULT,
      filter: { vaultId }
    });
    if (vaults.length === 0) throw new Error('Vault not found');

    const chainName = displayChainName || CHAIN_ID_TO_NAME[chainId] || `EVM-${chainId}`;

    await sdk.cantonExercise({
      contractId: vaults[0].contractId,
      templateId: TEMPLATE_IDS.VAULT,
      choice: CHOICES.REGISTER_CHAIN_VAULT,
      argument: { chain: chainName, custodyAddress: contractAddress }
    });

    // Return updated vault
    const updatedVaults = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.VAULT,
      filter: { vaultId }
    });
    if (updatedVaults.length > 0) {
      return {
        data: await recalcVaultPrices(contractToVault(updatedVaults[0])),
        contractAddress,
        txHash,
      };
    }
    return { data: null, contractAddress, txHash };
  },

  // Withdraw ETH or ERC20 from a vault's escrow contract
  withdrawFromEscrow: async (vaultId: string, chain: string, amountWei: string, tokenAddress?: string, symbol?: string) => {
    if (!sdk) throw new Error('SDK not available');

    // Get vault to find escrow address and user's EVM address
    const vaults = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.VAULT,
      filter: { vaultId }
    });
    if (vaults.length === 0) throw new Error('Vault not found');
    const vault = contractToVault(vaults[0]);
    const owner = (vaults[0].payload as Record<string, unknown>).owner as string;

    const chainVault = vault.chainVaults.find(cv => cv.chain === chain);
    if (!chainVault) throw new Error(`No escrow registered for chain: ${chain}`);
    const escrowAddress = chainVault.custodyAddress;

    // Determine chainId from chain name
    const chainId = CHAIN_NAME_TO_ID[chain] || getDefaultChainId();

    // Get user's EVM address as withdrawal destination
    const addresses = await sdk.getAddresses();
    const evmAddr = addresses.find(a => a.chainType === 'evm');
    if (!evmAddr) throw new Error('No EVM address found');

    // Encode and send withdraw call
    let callData: string;
    if (tokenAddress) {
      callData = encodeWithdrawERC20(tokenAddress, evmAddr.address, amountWei);
    } else {
      callData = encodeWithdrawETH(evmAddr.address, amountWei);
    }

    const result = await sdk.sendContractCall(escrowAddress, callData, chainId);

    // Also remove matching asset entries from the Daml vault record.
    // Use RAW entries (not aggregated) to correctly handle multiple deposits.
    const withdrawSymbol = symbol || (tokenAddress ? 'USDC' : 'ETH');
    const isStable = ['USDC', 'USDT'].includes(withdrawSymbol);
    const withdrawDecimals = isStable ? 6 : 18;
    const withdrawAmount = Number(BigInt(amountWei)) / (10 ** withdrawDecimals);
    const rawAssets = (vaults[0].payload as Record<string, unknown>).collateralAssets as Array<Record<string, unknown>> || [];
    const rawMatching = rawAssets
      .filter(a => resolveAssetSymbol(a.assetType as string, a.assetId as string) === withdrawSymbol)
      .map(a => ({
        assetId: a.assetId as string,
        amount: typeof a.amount === 'string' ? parseFloat(a.amount) : (a.amount as number) || 0,
      }))
      .sort((a, b) => a.amount - b.amount); // smallest first, greedily consume

    let damlRemaining = withdrawAmount;
    const damlCleanupErrors: string[] = [];

    if (rawMatching.length === 0) {
      console.warn(`[withdrawFromEscrow] No matching Daml entries found for ${withdrawSymbol} (vault has ${rawAssets.length} total entries)`);
      damlCleanupErrors.push(`No Daml entries found for ${withdrawSymbol}`);
    }

    for (const entry of rawMatching) {
      if (damlRemaining <= 0.001) break;
      try {
        const freshVaults = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.VAULT,
          filter: { vaultId }
        });
        if (freshVaults.length === 0) {
          damlCleanupErrors.push('Vault not found during cleanup');
          break;
        }

        await sdk.cantonExercise({
          contractId: freshVaults[0].contractId,
          templateId: TEMPLATE_IDS.VAULT,
          choice: CHOICES.WITHDRAW_ASSET,
          argument: { assetId: entry.assetId, issuer: owner }
        });
        console.log(`[withdrawFromEscrow] Removed Daml entry ${entry.assetId}: ${entry.amount} ${withdrawSymbol}`);

        // Re-deposit excess if this entry was larger than what we need
        if (entry.amount > damlRemaining + 0.001) {
          const excess = entry.amount - damlRemaining;
          const price = await getLivePrice(withdrawSymbol);
          const newAssetId = `${withdrawSymbol}-esc-remainder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const issuanceResult = await sdk.cantonCreate({
            templateId: TEMPLATE_IDS.ASSET_ISSUANCE,
            payload: {
              issuer: owner, recipient: owner,
              assetId: newAssetId, assetType: mapAssetTypeToEnum(withdrawSymbol),
              amount: toDecimal10(excess),
              valueUSD: toDecimal10(excess * price),
            },
          });
          const acceptResult = await sdk.cantonExercise({
            contractId: issuanceResult.contractId,
            templateId: TEMPLATE_IDS.ASSET_ISSUANCE,
            choice: 'Accept',
            argument: {},
          });
          const tokenCid = acceptResult.events?.find(
            (e: { templateId: string }) => e.templateId.includes('TokenizedAsset')
          )?.contractId;
          if (tokenCid) {
            const reVaults = await sdk.cantonQuery({
              templateId: TEMPLATE_IDS.VAULT,
              filter: { vaultId },
            });
            if (reVaults.length > 0) {
              await sdk.cantonExercise({
                contractId: reVaults[0].contractId,
                templateId: TEMPLATE_IDS.VAULT,
                choice: CHOICES.DEPOSIT_ASSET,
                argument: { assetCid: tokenCid },
              });
            }
          }
        }

        damlRemaining -= entry.amount;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[withdrawFromEscrow] Daml entry removal FAILED for ${entry.assetId}:`, err);
        damlCleanupErrors.push(`${entry.assetId}: ${msg}`);
      }
    }

    if (damlCleanupErrors.length > 0) {
      console.error('[withdrawFromEscrow] Daml cleanup errors:', damlCleanupErrors);
    }

    return {
      data: {
        txHash: result.transactionHash,
        status: result.status,
        damlCleanupErrors: damlCleanupErrors.length > 0 ? damlCleanupErrors : undefined,
      },
    };
  },

  // Withdraw a Canton-native asset (CC, CUSDC, or Canton USDC) from the vault back to the owner.
  // Order: custodian transfer FIRST, then Daml entry removal.
  // This ensures vault entries are intact if the transfer fails.
  withdrawCantonAsset: async (vaultId: string, symbol: string, amount: number, receiverUser?: string) => {
    if (!sdk) throw new Error('SDK not available');

    const vaults = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.VAULT,
      filter: { vaultId }
    });
    if (vaults.length === 0) throw new Error('Vault not found');

    const owner = (vaults[0].payload as Record<string, unknown>).owner as string;

    // Get the RAW (non-aggregated) asset entries from the Daml contract
    const rawAssets = (vaults[0].payload as Record<string, unknown>).collateralAssets as Array<Record<string, unknown>> || [];
    const matchingEntries = rawAssets
      .filter(a => resolveAssetSymbol(a.assetType as string, a.assetId as string) === symbol)
      .map(a => ({
        assetId: a.assetId as string,
        amount: typeof a.amount === 'string' ? parseFloat(a.amount) : (a.amount as number) || 0,
      }))
      .sort((a, b) => b.amount - a.amount); // largest first

    const totalAvailable = matchingEntries.reduce((sum, e) => sum + e.amount, 0);
    if (amount > totalAvailable + 0.001) {
      throw new Error(`Requested ${amount} ${symbol} but vault only has ${totalAvailable}`);
    }

    // Step 1: Transfer the requested amount from custodian back to user FIRST.
    // Do this before removing Daml entries so vault state is intact if transfer fails.
    if (symbol === 'CC' || symbol === 'CUSDC') {
      const withdrawRes = await fetch('/api/custodian/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverParty: owner, amount, receiverUser }),
      });
      const withdrawData = await withdrawRes.json() as { success?: boolean; error?: string; accepted?: boolean };
      if (!withdrawRes.ok || !withdrawData.success) {
        throw new Error(`Custodian ${symbol} transfer failed: ${withdrawData.error || 'Unknown error'}`);
      }
      if (!withdrawData.accepted) {
        throw new Error(`Custodian ${symbol} transfer offer created but could not be accepted — CC did not arrive in wallet. Contact support.`);
      }
      console.log(`[${symbol} Withdraw] Custodian transfer of ${amount} ${symbol} created and accepted`);
    } else if (symbol === 'USDC') {
      const withdrawRes = await fetch('/api/custodian/withdraw-usdc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverParty: owner, amount }),
      });
      const withdrawData = await withdrawRes.json() as { success?: boolean; error?: string };
      if (!withdrawRes.ok || !withdrawData.success) {
        throw new Error(`Canton USDC transfer failed: ${withdrawData.error || 'Unknown error'}`);
      }
      console.log(`[USDC Withdraw] Canton USDC transfer of ${amount} USDC created`);
    }

    // Step 2: Withdraw individual entries from the Daml vault to cover the requested amount.
    // Each WithdrawAsset removes one entry (all-or-nothing per assetId).
    // If we split a partial entry, we re-deposit the remainder.
    let remaining = amount;
    const damlErrors: string[] = [];
    for (const entry of matchingEntries) {
      if (remaining <= 0.001) break;

      try {
        // Re-query vault each iteration (contractId changes after each WithdrawAsset)
        const freshVaults = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.VAULT,
          filter: { vaultId },
        });
        if (freshVaults.length === 0) break;

        await sdk.cantonExercise({
          contractId: freshVaults[0].contractId,
          templateId: TEMPLATE_IDS.VAULT,
          choice: CHOICES.WITHDRAW_ASSET,
          argument: { assetId: entry.assetId, issuer: owner }
        });
        console.log(`[Canton Withdraw] Removed entry ${entry.assetId}: ${entry.amount} ${symbol}`);

        if (entry.amount > remaining + 0.001) {
          // Partial: re-deposit the excess back into the vault
          const excess = entry.amount - remaining;
          const price = await getLivePrice(symbol);
          try {
            const newAssetId = `${symbol}-remainder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const issuanceResult = await sdk.cantonCreate({
              templateId: TEMPLATE_IDS.ASSET_ISSUANCE,
              payload: {
                issuer: owner, recipient: owner,
                assetId: newAssetId, assetType: mapAssetTypeToEnum(symbol),
                amount: toDecimal10(excess),
                valueUSD: toDecimal10(excess * price),
              },
            });
            const acceptResult = await sdk.cantonExercise({
              contractId: issuanceResult.contractId,
              templateId: TEMPLATE_IDS.ASSET_ISSUANCE,
              choice: 'Accept',
              argument: {},
            });
            const tokenCid = acceptResult.events?.find(
              (e: { templateId: string }) => e.templateId.includes('TokenizedAsset')
            )?.contractId;
            if (tokenCid) {
              const reVaults = await sdk.cantonQuery({
                templateId: TEMPLATE_IDS.VAULT,
                filter: { vaultId },
              });
              if (reVaults.length > 0) {
                await sdk.cantonExercise({
                  contractId: reVaults[0].contractId,
                  templateId: TEMPLATE_IDS.VAULT,
                  choice: CHOICES.DEPOSIT_ASSET,
                  argument: { assetCid: tokenCid },
                });
                console.log(`[Canton Withdraw] Re-deposited excess: ${excess.toFixed(4)} ${symbol}`);
              }
            }
          } catch (err) {
            console.warn('[Canton Withdraw] Excess re-deposit failed:', err);
            damlErrors.push(`Re-deposit of excess ${excess.toFixed(4)} ${symbol} failed`);
          }
        }

        remaining -= entry.amount;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Canton Withdraw] Daml entry removal failed for ${entry.assetId}:`, err);
        damlErrors.push(`Failed to remove entry ${entry.assetId}: ${msg}`);
      }
    }

    if (damlErrors.length > 0) {
      console.warn('[Canton Withdraw] Daml cleanup had errors:', damlErrors);
    }

    return { success: true, damlErrors: damlErrors.length > 0 ? damlErrors : undefined };
  },

  // Close a vault — archive the Daml contract
  closeVault: async (vaultId: string) => {
    if (!sdk) throw new Error('SDK not available');

    const vaults = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.VAULT,
      filter: { vaultId }
    });
    if (vaults.length === 0) throw new Error('Vault not found');

    await sdk.cantonExercise({
      contractId: vaults[0].contractId,
      templateId: TEMPLATE_IDS.VAULT,
      choice: CHOICES.CLOSE_VAULT,
      argument: {}
    });

    return { success: true };
  },

  // Sync on-chain escrow balances with Daml-tracked collateral.
  // Detects external deposits (e.g. USDC sent directly to escrow address)
  // and mints TokenizedAssets + deposits them into the vault.
  syncEscrowDeposits: async (vaultId: string) => {
    if (!sdk) throw new Error('SDK not available');

    const vaults = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.VAULT,
      filter: { vaultId }
    });
    if (vaults.length === 0) throw new Error('Vault not found');

    const vaultContract = vaults[0];
    const vault = contractToVault(vaultContract);
    const owner = (vaultContract.payload as Record<string, unknown>).owner as string;

    if (!vault.chainVaults?.length) return { data: vault, synced: [] };

    const synced: Array<{ chain: string; symbol: string; amount: number }> = [];
    const livePrices = await fetchLivePrices();

    for (const cv of vault.chainVaults) {
      const chainId = CHAIN_NAME_TO_ID[cv.chain];
      if (!chainId) continue;

      // Read on-chain balances via server-side function
      try {
        const balRes = await fetch(`/api/escrow/balances?address=${cv.custodyAddress}&chainId=${chainId}`);
        if (!balRes.ok) continue;
        const bal = await balRes.json() as {
          eth: string; usdc: string;
          ethFormatted: string; usdcFormatted: string;
        };

        // Use per-chain tracked balances from depositRecords (not total across all chains)
        // to correctly handle multi-chain vaults (Ethereum + Base each with their own assets)
        const trackedEthOnChain = vault.chainBalancesBySymbol?.['ETH']?.[cv.chain] || 0;
        const trackedUsdcOnChain = vault.chainBalancesBySymbol?.['USDC']?.[cv.chain] || 0;

        // Check ETH balance
        const onChainEth = parseFloat(bal.ethFormatted);
        if (onChainEth > trackedEthOnChain + 0.0001) {
          const diff = onChainEth - trackedEthOnChain;
          const price = livePrices['ETH'] || FALLBACK_PRICES['ETH'] || 2000;
          await mintAndDeposit(vaultId, owner, 'ETH', diff, price, cv.chain);
          synced.push({ chain: cv.chain, symbol: 'ETH', amount: diff });
        }

        // Check USDC balance
        const onChainUsdc = parseFloat(bal.usdcFormatted);
        if (onChainUsdc > trackedUsdcOnChain + 0.01) {
          const diff = onChainUsdc - trackedUsdcOnChain;
          const price = livePrices['USDC'] || FALLBACK_PRICES['USDC'] || 1;
          await mintAndDeposit(vaultId, owner, 'USDC', diff, price, cv.chain);
          synced.push({ chain: cv.chain, symbol: 'USDC', amount: diff });
        }
      } catch (err) {
        console.warn(`[syncEscrow] Failed to read balances for ${cv.chain}:`, err);
      }
    }

    // Return updated vault
    const updatedVaults = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.VAULT,
      filter: { vaultId }
    });
    const updatedVault = updatedVaults.length > 0
      ? await recalcVaultPrices(contractToVault(updatedVaults[0]))
      : vault;

    return { data: updatedVault, synced };
  },

  // Deploy a DepositRelay contract for a chain (operator only, one per chain)
  deployDepositRelay: async (chainId: number, operatorAddress?: string) => {
    if (!sdk) throw new Error('SDK not available');

    // Use provided address or look up from wallet
    let opAddr = operatorAddress;
    if (!opAddr) {
      const addresses = await sdk.getAddresses();
      const evmAddr = addresses.find(a => a.chainType === 'evm' || a.chainType === 'base');
      if (!evmAddr) throw new Error('No EVM wallet found — ensure your account has an Ethereum or Base wallet');
      opAddr = evmAddr.address;
    }

    const { contractAddress, txHash } = await deployDepositRelay(sdk, chainId, opAddr);

    // Store relay address in runtime config
    const chainConfig = CHAIN_CONFIG[chainId];
    if (chainConfig) {
      chainConfig.relay = contractAddress;
    }

    // Persist to KV
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [`relay_${chainId}`]: contractAddress }),
      });
    } catch (err) {
      console.warn('Failed to persist relay address to KV:', err);
    }

    return { data: { contractAddress, txHash, chainId } };
  },

  // Forward ETH from relay pool to a vault escrow (operator only)
  forwardFromRelay: async (chainId: number, escrowAddress: string, amountWei: string) => {
    if (!sdk) throw new Error('SDK not available');

    const chainConfig = CHAIN_CONFIG[chainId];
    if (!chainConfig?.relay) throw new Error(`No relay deployed for chain ${chainId}`);

    const callData = encodeForwardETH(escrowAddress, amountWei);
    const result = await sdk.sendContractCall(chainConfig.relay, callData, chainId);
    return { data: { txHash: result.transactionHash, status: result.status } };
  },

  // Forward ERC20 from relay pool to a vault escrow (operator only)
  forwardERC20FromRelay: async (chainId: number, token: string, escrowAddress: string, amount: string) => {
    if (!sdk) throw new Error('SDK not available');

    const chainConfig = CHAIN_CONFIG[chainId];
    if (!chainConfig?.relay) throw new Error(`No relay deployed for chain ${chainId}`);

    const callData = encodeForwardERC20(token, escrowAddress, amount);
    const result = await sdk.sendContractCall(chainConfig.relay, callData, chainId);
    return { data: { txHash: result.transactionHash, status: result.status } };
  },
};

// Load relay addresses from KV on init
async function loadRelayAddresses(): Promise<void> {
  try {
    const res = await fetch('/api/config');
    const data = await res.json() as Record<string, unknown>;
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('relay_') && typeof value === 'string') {
        const chainId = parseInt(key.replace('relay_', ''), 10);
        if (!isNaN(chainId) && CHAIN_CONFIG[chainId]) {
          CHAIN_CONFIG[chainId].relay = value;
        }
      }
    }
  } catch {
    // Config endpoint may not be available during initial load
  }
}
loadRelayAddresses();

// Margin API
export const marginAPI = {
  verify: async (
    vaultId: string,
    requiredMargin: number,
    collateralValue: number,
    ltvThreshold?: number,
    assetValues?: number[],
  ) => {
    const ltv = collateralValue > 0 ? requiredMargin / collateralValue : (requiredMargin > 0 ? 999 : 0);
    const status = collateralValue >= requiredMargin ? 'Sufficient' : 'Insufficient';

    const result: VerificationResult = {
      status,
      ltv,
      ltvBps: Math.round(ltv * 10000),
      timestamp: new Date().toISOString(),
    };

    // Generate real ZK proof when asset values are provided
    if (assetValues && assetValues.length > 0) {
      try {
        const { generateLTVProof, verifyLTVProof, proofHash, usdToCents, ltvToBps, isZKAvailable } =
          await import('./zkProof');

        if (await isZKAvailable()) {
          const threshold = ltvThreshold ?? 0.8;
          const zkResult = await generateLTVProof({
            assetValuesCents: assetValues.map(usdToCents),
            notionalValueCents: usdToCents(requiredMargin),
            ltvThresholdBps: ltvToBps(threshold),
          });

          const verified = await verifyLTVProof(zkResult.proof, zkResult.publicSignals);
          const hash = await proofHash(zkResult.proof);

          result.ltvBps = zkResult.computedLTVBps;
          result.ltv = zkResult.computedLTVBps / 10000;
          result.zkProof = {
            proof: zkResult.proof,
            publicSignals: zkResult.publicSignals,
            proofHash: hash,
            isLiquidatable: zkResult.isLiquidatable,
            proofTimeMs: zkResult.proofTimeMs,
            verified,
          };
        }
      } catch (err) {
        console.warn('ZK proof generation failed, using plain LTV:', err);
      }
    }

    mockVerifications.set(vaultId, result);
    return { data: result };
  },

  getStatus: async (vaultId: string) => {
    const result = mockVerifications.get(vaultId);
    return { data: result || null };
  },

  createMarginCall: async (positionId: string, requiredAmount: number, provider: string, counterparty: string) => {
    // Note: MarginCall template requires provider, counterparty, AND operator as signatories.
    // Direct creation requires all parties to sign. In production, this would use a proposal workflow.
    // For demo purposes, we use mock data.

    // Fallback to mock
    const marginCall: MarginCall = {
      id: `MC-${Date.now()}`,
      positionId,
      requiredAmount,
      provider,
      counterparty,
      status: 'Active',
      createdAt: new Date().toISOString(),
    };
    mockMarginCalls.set(marginCall.id, marginCall);
    return { data: marginCall };
  },

  getActiveMarginCalls: async () => {
    // Try SDK first
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.MARGIN_CALL,
          filter: { status: 'Active' }
        });
        if (contracts.length > 0) {
          return { data: contracts.map(contractToMarginCall) };
        }
      } catch (error) {
        console.warn('Canton query failed, using mock:', error);
      }
    }

    // Fallback to mock
    const activeCalls = Array.from(mockMarginCalls.values()).filter(c => c.status === 'Active');
    return { data: activeCalls };
  },

  settleMarginCall: async (marginCallId: string) => {
    // Try SDK first
    if (sdk) {
      try {
        await sdk.cantonExercise({
          contractId: marginCallId,
          templateId: TEMPLATE_IDS.MARGIN_CALL,
          choice: CHOICES.SETTLE_MARGIN_CALL,
          argument: {}
        });
        return { data: { id: marginCallId, status: 'Settled' } };
      } catch (error) {
        console.warn('Canton exercise failed, using mock:', error);
      }
    }

    // Fallback to mock
    const call = mockMarginCalls.get(marginCallId);
    if (call) {
      call.status = 'Settled';
    }
    return { data: call };
  },
};

// Cached platform assets from /api/config
let cachedPlatformAssets: Array<{ type: string; name: string; category: string }> | null = null;
let platformAssetsCacheTime = 0;
const PLATFORM_ASSETS_CACHE_TTL = 120_000; // 2 minutes

// Asset API — fetches configurable platform assets from /api/config
export const assetAPI = {
  getTypes: async () => {
    const now = Date.now();
    if (cachedPlatformAssets && now - platformAssetsCacheTime < PLATFORM_ASSETS_CACHE_TTL) {
      return { data: cachedPlatformAssets };
    }
    try {
      const res = await fetch('/api/config');
      const data = await res.json() as { platformAssets?: Array<{ type: string; name: string; category: string }> };
      if (data.platformAssets && data.platformAssets.length > 0) {
        cachedPlatformAssets = data.platformAssets;
        platformAssetsCacheTime = now;
        return { data: cachedPlatformAssets };
      }
    } catch (err) {
      console.warn('Failed to fetch platform assets from config:', err);
    }
    // Fallback to defaults matching wallet SDK tokens
    const defaults = [
      { type: 'BTC', name: 'Bitcoin', category: 'Crypto' },
      { type: 'ETH', name: 'Ethereum', category: 'Crypto' },
      { type: 'SOL', name: 'Solana', category: 'Crypto' },
      { type: 'CC', name: 'Canton Coin', category: 'Crypto' },
      { type: 'USDC', name: 'USD Coin', category: 'Stablecoin' },
      { type: 'USDT', name: 'Tether', category: 'Stablecoin' },
      { type: 'TRX', name: 'Tron', category: 'Crypto' },
      { type: 'TON', name: 'Toncoin', category: 'Crypto' },
      { type: 'CUSD', name: 'CUSD', category: 'Stablecoin' },
      { type: 'CUSDC', name: 'USDC (Canton)', category: 'Stablecoin' },
    ];
    return { data: defaults };
  },

  // Save platform assets to config (operator only)
  saveTypes: async (assets: Array<{ type: string; name: string; category: string }>) => {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platformAssets: assets }),
    });
    const data = await res.json() as { success: boolean };
    if (data.success) {
      cachedPlatformAssets = assets;
      platformAssetsCacheTime = Date.now();
    }
    return data;
  },

  // Invalidate cache (after operator edits)
  invalidateCache: () => {
    cachedPlatformAssets = null;
    platformAssetsCacheTime = 0;
  },

  getPrice: async (assetType: string) => {
    const prices = await fetchLivePrices();
    return { data: { price: prices[assetType] || FALLBACK_PRICES[assetType] || 1 } };
  },
};

// Role API — Canton-backed role management
export const roleAPI = {
  // Create OperatorRole contract (called once during system init)
  createOperatorRole: async (operator: string) => {
    if (sdk) {
      try {
        const result = await sdk.cantonCreate({
          templateId: TEMPLATE_IDS.OPERATOR_ROLE,
          payload: { operator },
        });
        return { data: { contractId: result.contractId } };
      } catch (error) {
        console.warn('Canton createOperatorRole failed:', error);
      }
    }
    return { data: { contractId: null } };
  },

  // Get existing OperatorRole contract
  getOperatorRole: async (operator: string) => {
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.OPERATOR_ROLE,
          filter: { operator },
        });
        if (contracts.length > 0) {
          return { data: { contractId: contracts[0].contractId } };
        }
      } catch (error) {
        console.warn('Canton getOperatorRole failed:', error);
      }
    }
    return { data: { contractId: null } };
  },

  // Operator assigns a primebroker via OperatorRole choice
  assignPrimeBroker: async (operatorRoleContractId: string, broker: string) => {
    if (sdk) {
      try {
        const result = await sdk.cantonExercise({
          contractId: operatorRoleContractId,
          templateId: TEMPLATE_IDS.OPERATOR_ROLE,
          choice: CHOICES.ASSIGN_PRIME_BROKER,
          argument: { broker },
        });
        return { data: { success: true, events: result.events } };
      } catch (error) {
        console.warn('Canton assignPrimeBroker failed:', error);
      }
    }
    return { data: { success: false } };
  },

  // Operator assigns a fund via OperatorRole choice
  assignFund: async (operatorRoleContractId: string, fund: string) => {
    if (sdk) {
      try {
        const result = await sdk.cantonExercise({
          contractId: operatorRoleContractId,
          templateId: TEMPLATE_IDS.OPERATOR_ROLE,
          choice: CHOICES.ASSIGN_FUND,
          argument: { fund },
        });
        return { data: { success: true, events: result.events } };
      } catch (error) {
        console.warn('Canton assignFund failed:', error);
      }
    }
    return { data: { success: false } };
  },

  // Create BrokerRole contract (operator + broker must sign)
  createBrokerRole: async (broker: string, operator: string) => {
    if (sdk) {
      try {
        const result = await sdk.cantonCreate({
          templateId: TEMPLATE_IDS.BROKER_ROLE,
          payload: { broker, operator },
        });
        return { data: { contractId: result.contractId } };
      } catch (error) {
        console.warn('Canton createBrokerRole failed:', error);
      }
    }
    return { data: { contractId: null } };
  },

  // Get BrokerRole contract for a broker
  getBrokerRole: async (broker: string) => {
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.BROKER_ROLE,
          filter: { broker },
        });
        if (contracts.length > 0) {
          return { data: { contractId: contracts[0].contractId } };
        }
      } catch (error) {
        console.warn('Canton getBrokerRole failed:', error);
      }
    }
    return { data: { contractId: null } };
  },

  // Broker assigns a fund via BrokerRole choice
  brokerAssignFund: async (brokerRoleContractId: string, fund: string) => {
    if (sdk) {
      try {
        const result = await sdk.cantonExercise({
          contractId: brokerRoleContractId,
          templateId: TEMPLATE_IDS.BROKER_ROLE,
          choice: CHOICES.BROKER_ASSIGN_FUND,
          argument: { fund },
        });
        return { data: { success: true, events: result.events } };
      } catch (error) {
        console.warn('Canton brokerAssignFund failed:', error);
      }
    }
    return { data: { success: false } };
  },

  // Query all RoleAssignment contracts visible to current party
  getRoleAssignments: async () => {
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.ROLE_ASSIGNMENT,
        });
        return {
          data: contracts.map((c) => ({
            contractId: c.contractId,
            party: (c.payload as Record<string, unknown>).party as string,
            role: (c.payload as Record<string, unknown>).role as string,
            assignedBy: (c.payload as Record<string, unknown>).assignedBy as string,
          })),
        };
      } catch (error) {
        console.warn('Canton getRoleAssignments failed:', error);
      }
    }
    return { data: [] };
  },

  // Query role for a specific party
  getRoleForParty: async (party: string) => {
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.ROLE_ASSIGNMENT,
          filter: { party },
        });
        if (contracts.length > 0) {
          return {
            data: {
              contractId: contracts[0].contractId,
              role: (contracts[0].payload as Record<string, unknown>).role as string,
            },
          };
        }
      } catch (error) {
        console.warn('Canton getRoleForParty failed:', error);
      }
    }
    return { data: { contractId: null, role: null } };
  },

  // Revoke a role assignment (operator only)
  revokeRole: async (roleAssignmentContractId: string) => {
    if (sdk) {
      try {
        await sdk.cantonExercise({
          contractId: roleAssignmentContractId,
          templateId: TEMPLATE_IDS.ROLE_ASSIGNMENT,
          choice: CHOICES.REVOKE_ROLE,
          argument: {},
        });
        return { data: { success: true } };
      } catch (error) {
        console.warn('Canton revokeRole failed:', error);
      }
    }
    return { data: { success: false } };
  },
};

// Invitation API — broker-fund invitation management
export interface Invitation {
  contractId: string;
  broker: string;
  fund: string;
  operator: string;
  invitationId: string;
  createdAt: string;
  status: string;
}

export const invitationAPI = {
  send: async (broker: string, fund: string, _operator: string) => {
    if (sdk) {
      try {
        const invitationId = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        // Broker acts as operator for invitation creation (single-participant submission)
        const result = await sdk.cantonCreate({
          templateId: TEMPLATE_IDS.BROKER_FUND_INVITATION,
          payload: {
            broker,
            fund,
            operator: broker,
            invitationId,
            createdAt: new Date().toISOString(),
            status: 'Pending',
          },
        });
        return { data: { contractId: result.contractId, invitationId } };
      } catch (error) {
        console.warn('Canton send invitation failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },

  accept: async (contractId: string) => {
    if (sdk) {
      try {
        const result = await sdk.cantonExercise({
          contractId,
          templateId: TEMPLATE_IDS.BROKER_FUND_INVITATION,
          choice: CHOICES.ACCEPT_INVITATION,
          argument: {},
        });
        return { data: { success: true, events: result.events } };
      } catch (error) {
        console.warn('Canton accept invitation failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },

  reject: async (contractId: string) => {
    if (sdk) {
      try {
        await sdk.cantonExercise({
          contractId,
          templateId: TEMPLATE_IDS.BROKER_FUND_INVITATION,
          choice: CHOICES.REJECT_INVITATION,
          argument: {},
        });
        return { data: { success: true } };
      } catch (error) {
        console.warn('Canton reject invitation failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },

  listPendingForFund: async (fund: string) => {
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.BROKER_FUND_INVITATION,
          filter: { fund },
        });
        return {
          data: contracts.map((c) => ({
            contractId: c.contractId,
            broker: (c.payload as Record<string, unknown>).broker as string,
            fund: (c.payload as Record<string, unknown>).fund as string,
            operator: (c.payload as Record<string, unknown>).operator as string,
            invitationId: (c.payload as Record<string, unknown>).invitationId as string,
            createdAt: (c.payload as Record<string, unknown>).createdAt as string,
            status: (c.payload as Record<string, unknown>).status as string,
          })),
        };
      } catch (error) {
        console.warn('Canton query invitations failed:', error);
      }
    }
    return { data: [] };
  },

  listSentByBroker: async (broker: string) => {
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.BROKER_FUND_INVITATION,
          filter: { broker },
        });
        return {
          data: contracts.map((c) => ({
            contractId: c.contractId,
            broker: (c.payload as Record<string, unknown>).broker as string,
            fund: (c.payload as Record<string, unknown>).fund as string,
            operator: (c.payload as Record<string, unknown>).operator as string,
            invitationId: (c.payload as Record<string, unknown>).invitationId as string,
            createdAt: (c.payload as Record<string, unknown>).createdAt as string,
            status: (c.payload as Record<string, unknown>).status as string,
          })),
        };
      } catch (error) {
        console.warn('Canton query invitations failed:', error);
      }
    }
    return { data: [] };
  },
};

// Link API — broker-fund link management
export interface BrokerFundLinkData {
  contractId: string;
  broker: string;
  fund: string;
  operator: string;
  linkId: string;
  ltvThreshold: number;
  leverageRatio: number;
  isActive: boolean;
  linkedAt: string;
  allowedAssets: string[];
  allowedCollaterals: string[];
}

// Safely extract tuple list from Daml Optional [(Text, Text, ...)]
// Canton JSON API encodes tuples as arrays, but Optional wrapping can vary
function parseOptionalTupleList(raw: unknown, _tupleSize: number): string[][] {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  // Could be nested due to Optional encoding: [[["a","b"]]] or [["a","b"]]
  // Each item should be an array (tuple) or an object with _1, _2, etc.
  return raw.map((item: unknown) => {
    if (Array.isArray(item)) return item.map(String);
    if (item && typeof item === 'object') {
      // Canton may encode tuples as { _1: "a", _2: "b", ... }
      const obj = item as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      return keys.map(k => String(obj[k] || ''));
    }
    return [String(item)];
  });
}

// Safely extract string array from Daml Optional [Text]
// Canton JSON API may return: null, ["a","b"], or nested structures
function parseOptionalTextList(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    // Could be ["BTC","ETH"] or [["BTC","ETH"]] (nested optional encoding)
    if (raw.length > 0 && Array.isArray(raw[0])) {
      return raw[0] as string[];
    }
    return raw as string[];
  }
  return [];
}

export const linkAPI = {
  getLinksForBroker: async (broker: string) => {
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.BROKER_FUND_LINK,
          filter: { broker },
        });
        return {
          data: contracts.map((c) => {
            const p = c.payload as Record<string, unknown>;
            const rawThreshold = p.ltvThreshold;
            const rawLeverage = p.leverageRatio;
            console.log('[linkAPI] BrokerFundLink payload allowedAssets:', JSON.stringify(p.allowedAssets));
            return {
              contractId: c.contractId,
              broker: p.broker as string,
              fund: p.fund as string,
              operator: p.operator as string,
              linkId: p.linkId as string,
              ltvThreshold: typeof rawThreshold === 'string' ? parseFloat(rawThreshold) : (rawThreshold as number) || 0.8,
              leverageRatio: rawLeverage != null ? (typeof rawLeverage === 'string' ? parseFloat(rawLeverage) : (rawLeverage as number)) : 1,
              isActive: p.isActive as boolean,
              linkedAt: p.linkedAt as string,
              allowedAssets: parseOptionalTextList(p.allowedAssets),
              allowedCollaterals: parseOptionalTextList(p.allowedCollaterals),
            };
          }),
        };
      } catch (error) {
        console.warn('Canton query links failed:', error);
      }
    }
    return { data: [] };
  },

  getLinksForFund: async (fund: string) => {
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.BROKER_FUND_LINK,
          filter: { fund },
        });
        return {
          data: contracts.map((c) => {
            const p = c.payload as Record<string, unknown>;
            const rawThreshold = p.ltvThreshold;
            const rawLeverage = p.leverageRatio;
            console.log('[linkAPI] BrokerFundLink payload for fund allowedAssets:', JSON.stringify(p.allowedAssets));
            return {
              contractId: c.contractId,
              broker: p.broker as string,
              fund: p.fund as string,
              operator: p.operator as string,
              linkId: p.linkId as string,
              ltvThreshold: typeof rawThreshold === 'string' ? parseFloat(rawThreshold) : (rawThreshold as number) || 0.8,
              leverageRatio: rawLeverage != null ? (typeof rawLeverage === 'string' ? parseFloat(rawLeverage) : (rawLeverage as number)) : 1,
              isActive: p.isActive as boolean,
              linkedAt: p.linkedAt as string,
              allowedAssets: parseOptionalTextList(p.allowedAssets),
              allowedCollaterals: parseOptionalTextList(p.allowedCollaterals),
            };
          }),
        };
      } catch (error) {
        console.warn('Canton query links failed:', error);
      }
    }
    return { data: [] };
  },

  setAutoLiquidate: async (broker: string, fund: string, enabled: boolean) => {
    const resp = await fetch('/api/auto-liquidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ broker, fund, enabled }),
    });
    if (!resp.ok) throw new Error('Failed to set auto-liquidate preference');
    return await resp.json() as { success: boolean };
  },

  getAutoLiquidatePrefs: async (broker: string): Promise<Record<string, boolean>> => {
    const resp = await fetch(`/api/auto-liquidate?broker=${encodeURIComponent(broker)}`);
    if (!resp.ok) return {};
    const data = await resp.json() as { preferences: Record<string, boolean> };
    return data.preferences || {};
  },

  setLTVThreshold: async (contractId: string, newThreshold: number) => {
    if (sdk) {
      try {
        const result = await sdk.cantonExercise({
          contractId,
          templateId: TEMPLATE_IDS.BROKER_FUND_LINK,
          choice: CHOICES.SET_LTV_THRESHOLD,
          argument: { newThreshold: toDecimal10(newThreshold) },
        });
        return { data: { success: true, events: result.events } };
      } catch (error) {
        console.warn('Canton setLTVThreshold failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },

  updateAllowedAssets: async (contractId: string, newAllowedAssets: string[]) => {
    if (sdk) {
      try {
        const result = await sdk.cantonExercise({
          contractId,
          templateId: TEMPLATE_IDS.BROKER_FUND_LINK,
          choice: CHOICES.UPDATE_ALLOWED_ASSETS,
          argument: { newAllowedAssets },
        });
        return { data: { success: true, events: result.events } };
      } catch (error) {
        console.warn('Canton updateAllowedAssets failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },

  updateAllowedCollaterals: async (contractId: string, newAllowedCollaterals: string[]) => {
    if (sdk) {
      try {
        const result = await sdk.cantonExercise({
          contractId,
          templateId: TEMPLATE_IDS.BROKER_FUND_LINK,
          choice: CHOICES.UPDATE_ALLOWED_COLLATERALS,
          argument: { newAllowedCollaterals },
        });
        return { data: { success: true, events: result.events } };
      } catch (error) {
        console.warn('Canton updateAllowedCollaterals failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },

  deactivate: async (contractId: string) => {
    if (sdk) {
      try {
        await sdk.cantonExercise({
          contractId,
          templateId: TEMPLATE_IDS.BROKER_FUND_LINK,
          choice: CHOICES.DEACTIVATE_LINK,
          argument: {},
        });
        return { data: { success: true } };
      } catch (error) {
        console.warn('Canton deactivateLink failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },
};

// LTV Change Proposal API
export interface LTVChangeProposalData {
  contractId: string;
  broker: string;
  fund: string;
  operator: string;
  linkContractId: string;
  proposedThreshold: number;
  proposedLeverage: number | null;
  currentThreshold: number;
  currentLeverage: number | null;
  proposalId: string;
  createdAt: string;
}

function contractToProposal(c: CantonContract<Record<string, unknown>>): LTVChangeProposalData {
  const p = c.payload as Record<string, unknown>;
  const rawProposedLev = p.proposedLeverage;
  const rawCurrentLev = p.currentLeverage;
  return {
    contractId: c.contractId,
    broker: p.broker as string,
    fund: p.fund as string,
    operator: p.operator as string,
    linkContractId: p.linkContractId as string,
    proposedThreshold: typeof p.proposedThreshold === 'string' ? parseFloat(p.proposedThreshold) : (p.proposedThreshold as number) || 0,
    proposedLeverage: rawProposedLev != null ? (typeof rawProposedLev === 'string' ? parseFloat(rawProposedLev) : (rawProposedLev as number)) : null,
    currentThreshold: typeof p.currentThreshold === 'string' ? parseFloat(p.currentThreshold) : (p.currentThreshold as number) || 0,
    currentLeverage: rawCurrentLev != null ? (typeof rawCurrentLev === 'string' ? parseFloat(rawCurrentLev) : (rawCurrentLev as number)) : null,
    proposalId: p.proposalId as string,
    createdAt: p.createdAt as string,
  };
}

export const proposalAPI = {
  propose: async (linkContractId: string, proposedThreshold: number, _currentThreshold: number, proposedLeverage?: number) => {
    if (sdk) {
      try {
        const proposalId = `LTV-${Date.now()}`;
        const result = await sdk.cantonExercise({
          contractId: linkContractId,
          templateId: TEMPLATE_IDS.BROKER_FUND_LINK,
          choice: CHOICES.PROPOSE_LTV_CHANGE,
          argument: {
            proposedThreshold: toDecimal10(proposedThreshold),
            proposedLeverage: proposedLeverage != null ? toDecimal10(proposedLeverage) : null,
            proposalId,
            proposalCreatedAt: new Date().toISOString(),
          },
        });
        return { data: { proposalId, events: result.events } };
      } catch (error) {
        console.warn('Canton proposeLTVChange failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },

  listForFund: async (fund: string) => {
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.LTV_CHANGE_PROPOSAL,
          filter: { fund },
        });
        return { data: contracts.map(contractToProposal) };
      } catch (error) {
        console.warn('Canton query proposals failed:', error);
      }
    }
    return { data: [] as LTVChangeProposalData[] };
  },

  listForBroker: async (broker: string) => {
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.LTV_CHANGE_PROPOSAL,
          filter: { broker },
        });
        return { data: contracts.map(contractToProposal) };
      } catch (error) {
        console.warn('Canton query proposals failed:', error);
      }
    }
    return { data: [] as LTVChangeProposalData[] };
  },

  accept: async (contractId: string) => {
    if (sdk) {
      try {
        const result = await sdk.cantonExercise({
          contractId,
          templateId: TEMPLATE_IDS.LTV_CHANGE_PROPOSAL,
          choice: CHOICES.ACCEPT_PROPOSAL,
          argument: {},
        });
        return { data: { success: true, events: result.events } };
      } catch (error) {
        console.warn('Canton acceptProposal failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },

  reject: async (contractId: string, fundParty: string, linkBroker: string) => {
    if (sdk) {
      try {
        // 1. Exercise RejectProposal (deactivates link)
        await sdk.cantonExercise({
          contractId,
          templateId: TEMPLATE_IDS.LTV_CHANGE_PROPOSAL,
          choice: CHOICES.REJECT_PROPOSAL,
          argument: {},
        });
        // 2. Close all positions for this broker-fund pair
        const positions = await positionAPI.listByFund(fundParty);
        for (const pos of positions.data.filter(p => p.broker === linkBroker && p.status === 'Open')) {
          try {
            await positionAPI.close(pos.positionId);
          } catch (err) {
            console.warn('Failed to close position:', pos.positionId, err);
          }
        }
        return { data: { success: true } };
      } catch (error) {
        console.warn('Canton rejectProposal failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },
};

// Position API — position management
export interface PositionData {
  contractId: string;
  fund: string;
  broker: string;
  operator: string;
  positionId: string;
  vaultId: string;
  description: string;
  assetSymbol: string;
  direction: 'Long' | 'Short';
  notionalValue: number;
  entryPrice: number;
  units: number;
  unrealizedPnL: number;
  closingPrice: number;
  collateralValue: number;
  currentLTV: number;
  status: string;
  createdAt: string;
  lastChecked: string;
  zkCollateralProofHash?: string;
  zkProofTimestamp?: string;
}

export interface LiquidationRecord {
  positionId: string;
  liquidatedAt: string;
  liquidationAmountUSD: number;
  pnl: number;
  collateralValueAtLiquidation: number;
  ltvAtLiquidation: number;
  ltvThreshold: number;
  escrowLiquidations: Array<{
    chain: string;
    custodyAddress: string;
    ethSeized: string;
    ethValueUSD: number;
    usdcSeized: string;
    txHashes: string[];
  }>;
  ccSeized: Array<{
    symbol: string;
    amount: number;
    valueUSD: number;
  }>;
  cantonSettlement: Array<{
    symbol: string;
    amount: number;
    valueUSD: number;
    source: 'bridge' | 'direct';
  }>;
  brokerRecipient: string;
  brokerCantonParty: string;
}

const liquidationRecords = new Map<string, LiquidationRecord>();

function parseDecimal(v: unknown): number {
  if (typeof v === 'string') return parseFloat(v) || 0;
  return (v as number) || 0;
}

function contractToPosition(c: CantonContract<Record<string, unknown>>): PositionData {
  const p = c.payload as Record<string, unknown>;
  // direction is Optional PositionDirection — could be null, "Long", "Short"
  const rawDir = p.direction;
  const direction: 'Long' | 'Short' = rawDir === 'Short' ? 'Short' : 'Long';
  // Parse asset symbol from description (e.g. "LONG 2 BTC" → "BTC")
  const desc = (p.description as string) || '';
  const assetSymbol = desc.trim().split(/\s+/).pop() || '';

  return {
    contractId: c.contractId,
    fund: p.fund as string,
    broker: p.broker as string,
    operator: p.operator as string,
    positionId: p.positionId as string,
    vaultId: p.vaultId as string,
    description: desc,
    assetSymbol,
    direction,
    notionalValue: parseDecimal(p.notionalValue),
    entryPrice: parseDecimal(p.entryPrice),
    units: parseDecimal(p.units),
    unrealizedPnL: parseDecimal(p.unrealizedPnL),
    closingPrice: parseDecimal(p.closingPrice),
    collateralValue: 0,
    currentLTV: parseDecimal(p.currentLTV),
    status: p.status as string,
    createdAt: p.createdAt as string,
    lastChecked: p.lastChecked as string,
    zkCollateralProofHash: (p.zkCollateralProofHash as string) || undefined,
    zkProofTimestamp: (p.zkProofTimestamp as string) || undefined,
  };
}

// ZK proof KV helpers — store/fetch full proofs via Pages Function
async function storeZKProofToKV(hash: string, proofData: unknown): Promise<void> {
  try {
    await fetch('/api/zkproof', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash, proof: proofData }),
    });
  } catch {
    // fire-and-forget — ZK storage failure is non-critical
  }
}

export async function fetchZKProof(hash: string): Promise<unknown | null> {
  try {
    const res = await fetch(`/api/zkproof?hash=${encodeURIComponent(hash)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data as Record<string, unknown>).proof || null;
  } catch {
    return null;
  }
}

// Recalculate position collateralValue, PnL, and LTV with live prices.
// Fetches each unique vault once, reprices, then aggregates across positions sharing a vault.
async function recalcPositionsLive(positions: PositionData[]): Promise<PositionData[]> {
  if (positions.length === 0 || !sdk) return positions;

  const prices = await fetchLivePrices();

  // Fetch unique vaults and recalc their value
  const uniqueVaultIds = [...new Set(positions.map(p => p.vaultId))];
  const vaultValues: Record<string, number> = {};
  for (const vid of uniqueVaultIds) {
    try {
      const vaults = await sdk.cantonQuery({ templateId: TEMPLATE_IDS.VAULT, filter: { vaultId: vid } });
      if (vaults.length > 0) {
        const vault = await recalcVaultPrices(contractToVault(vaults[0]));
        vaultValues[vid] = vault.totalValue;
      }
    } catch { /* use 0 */ }
  }

  // Compute per-position PnL (only for active positions; closed/liquidated keep their on-ledger value)
  const withPnL = positions.map(pos => {
    if (pos.status === 'Closed' || pos.status === 'Liquidated') {
      return pos;
    }
    const entryPrice = pos.entryPrice || 0;
    const units = pos.units || 0;
    const symbol = pos.description.trim().split(/\s+/).pop() || '';
    const currentPrice = prices[symbol] || 0;
    let pnl = 0;
    if (entryPrice && units && currentPrice) {
      pnl = pos.direction === 'Short'
        ? units * (entryPrice - currentPrice)
        : units * (currentPrice - entryPrice);
    }
    return { ...pos, unrealizedPnL: pnl };
  });

  // Aggregate notional + PnL per vault (open/margin-called only)
  const vaultAgg: Record<string, { totalNotional: number; totalPnL: number }> = {};
  for (const pos of withPnL) {
    if (pos.status !== 'Open' && pos.status !== 'MarginCalled') continue;
    if (!vaultAgg[pos.vaultId]) vaultAgg[pos.vaultId] = { totalNotional: 0, totalPnL: 0 };
    vaultAgg[pos.vaultId].totalNotional += pos.notionalValue;
    vaultAgg[pos.vaultId].totalPnL += pos.unrealizedPnL;
  }

  // Fetch broker-fund links to get per-link leverage ratio
  const brokerFundPairs = [...new Set(positions.map(p => `${p.broker}|${p.fund}`))];
  const linkLeverageMap: Record<string, number> = {};
  for (const pair of brokerFundPairs) {
    const [broker, fund] = pair.split('|');
    try {
      const linkContracts = await sdk.cantonQuery({ templateId: TEMPLATE_IDS.BROKER_FUND_LINK, filter: { broker, fund } });
      if (linkContracts.length > 0) {
        const lp = linkContracts[0].payload as Record<string, unknown>;
        const rawLev = lp.leverageRatio;
        linkLeverageMap[pair] = rawLev != null ? (typeof rawLev === 'string' ? parseFloat(rawLev) : (rawLev as number)) || 1 : 1;
      }
    } catch { /* default to 1 */ }
  }

  // Recalc collateralValue and LTV (leverage-aware)
  const result = withPnL.map(pos => {
    const collateral = vaultValues[pos.vaultId];
    // If vault wasn't visible (e.g. broker can't see fund's vault), keep on-ledger LTV
    if (collateral === undefined) {
      return pos;
    }
    const agg = vaultAgg[pos.vaultId];
    const effectiveCollateral = collateral + (agg?.totalPnL || 0);
    const totalNotional = agg?.totalNotional || pos.notionalValue;
    const leverage = linkLeverageMap[`${pos.broker}|${pos.fund}`] || 1;
    const ltv = effectiveCollateral > 0 ? totalNotional / (effectiveCollateral * leverage) : (totalNotional > 0 ? 999 : 0);
    return { ...pos, collateralValue: collateral, currentLTV: ltv };
  });

  // ZK proof generation — fund only, one proof per vault, skip if recent proof exists
  try {
    const currentParty = await sdk.getPartyId?.() || '';
    const fundParties = [...new Set(result.map(p => p.fund))];
    const isFund = fundParties.includes(currentParty);

    if (isFund) {
      const { generateLTVProof, proofHash: computeProofHash, usdToCents, isZKAvailable } =
        await import('./zkProof');

      if (await isZKAvailable()) {
        // Group active positions by vault
        const vaultPositions: Record<string, PositionData[]> = {};
        for (const pos of result) {
          if (pos.status !== 'Open' && pos.status !== 'MarginCalled') continue;
          if (pos.fund !== currentParty) continue;
          if (!vaultPositions[pos.vaultId]) vaultPositions[pos.vaultId] = [];
          vaultPositions[pos.vaultId].push(pos);
        }

        const ZK_PROOF_MIN_INTERVAL = 5 * 60 * 1000; // 5 minutes

        for (const [vid, vPositions] of Object.entries(vaultPositions)) {
          // Skip if existing proof < 5 min old
          const existingTs = vPositions[0]?.zkProofTimestamp;
          if (existingTs && (Date.now() - new Date(existingTs).getTime()) < ZK_PROOF_MIN_INTERVAL) {
            continue;
          }

          const collateral = vaultValues[vid];
          if (collateral === undefined || collateral <= 0) continue;

          const agg = vaultAgg[vid];
          const totalNotional = agg?.totalNotional || 0;
          if (totalNotional <= 0) continue;

          // Use per-link leverage to scale the ZK threshold
          const refPos = vPositions[0];
          const zkLeverage = linkLeverageMap[`${refPos.broker}|${refPos.fund}`] || 1;
          // Scale collateral by leverage for ZK proof: proves collateral * leverage >= notional at threshold
          const zkResult = await generateLTVProof({
            assetValuesCents: [usdToCents(collateral * zkLeverage)],
            notionalValueCents: usdToCents(totalNotional),
            ltvThresholdBps: 8000, // 80% standard threshold (leverage already factored into collateral)
          });

          const hash = await computeProofHash(zkResult.proof);
          const attestedAt = new Date().toISOString();

          // Store full proof to KV (fire-and-forget)
          storeZKProofToKV(hash, {
            proof: zkResult.proof,
            publicSignals: zkResult.publicSignals,
            computedLTVBps: zkResult.computedLTVBps,
            vaultId: vid,
            attestedAt,
          });

          // Exercise AttestCollateral on each position sharing this vault
          for (const pos of vPositions) {
            try {
              await sdk.cantonExercise({
                templateId: TEMPLATE_IDS.POSITION,
                contractId: pos.contractId,
                choice: CHOICES.ATTEST_COLLATERAL,
                argument: { proofHash: hash, attestedAt },
              });
              // Update local result with new ZK fields
              pos.zkCollateralProofHash = hash;
              pos.zkProofTimestamp = attestedAt;
            } catch {
              // Individual attestation failure is non-critical
            }
          }
        }
      }
    }
  } catch {
    // ZK proof generation failure never blocks position loading
  }

  return result;
}

export const positionAPI = {
  create: async (
    fund: string,
    broker: string,
    _operator: string,
    vaultId: string,
    description: string,
    notionalValue: number,
    direction: 'Long' | 'Short' = 'Long',
    entryPrice: number = 0,
    units: number = 0,
  ) => {
    if (sdk) {
      try {
        // Get vault value with live prices for initial LTV calculation
        let collateralValue = 0;
        try {
          const vaults = await sdk.cantonQuery({
            templateId: TEMPLATE_IDS.VAULT,
            filter: { vaultId },
          });
          if (vaults.length > 0) {
            const vault = await recalcVaultPrices(contractToVault(vaults[0]));
            collateralValue = vault.totalValue;
          }
        } catch {
          // Use 0 if vault query fails
        }

        // Sum existing open positions' notional on this vault for aggregate LTV
        let existingNotional = 0;
        try {
          const existingPositions = await sdk.cantonQuery({
            templateId: TEMPLATE_IDS.POSITION,
            filter: { vaultId },
          });
          for (const ep of existingPositions) {
            const payload = ep.payload as Record<string, unknown>;
            const status = payload.status as string;
            if (status === 'Open' || status === 'MarginCalled') {
              existingNotional += parseDecimal(payload.notionalValue);
            }
          }
        } catch {
          // ignore — worst case we under-count
        }

        const totalNotional = existingNotional + notionalValue;
        const currentLTV = collateralValue > 0 ? totalNotional / collateralValue : 0;
        const positionId = `POS-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const now = new Date().toISOString();

        // Use real operator party for position creation (required for LiquidatePosition choice)
        const operatorParty = await getOperatorParty() || fund;
        const result = await sdk.cantonCreate({
          templateId: TEMPLATE_IDS.POSITION,
          payload: {
            fund,
            broker,
            operator: operatorParty,
            positionId,
            vaultId,
            description,
            direction: direction === 'Short' ? 'Short' : 'Long',
            notionalValue: toDecimal10(notionalValue),
            entryPrice: entryPrice > 0 ? toDecimal10(entryPrice) : null,
            units: units > 0 ? toDecimal10(units) : null,
            unrealizedPnL: toDecimal10(0),
            closingPrice: null,
            zkCollateralProofHash: null,
            zkProofTimestamp: null,
            currentLTV: toDecimal10(currentLTV),
            status: 'Open',
            createdAt: now,
            lastChecked: now,
          },
        });
        return { data: { contractId: result.contractId, positionId, currentLTV } };
      } catch (error) {
        console.warn('Canton create position failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },

  listByFund: async (fund: string) => {
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.POSITION,
          filter: { fund },
        });
        const positions = contracts.map(contractToPosition);
        return { data: await recalcPositionsLive(positions) };
      } catch (error) {
        console.warn('Canton query positions failed:', error);
      }
    }
    return { data: [] };
  },

  listByBroker: async (broker: string) => {
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.POSITION,
          filter: { broker },
        });
        const positions = contracts.map(contractToPosition);
        return { data: await recalcPositionsLive(positions) };
      } catch (error) {
        console.warn('Canton query positions failed:', error);
      }
    }
    return { data: [] };
  },

  close: async (positionId: string) => {
    if (sdk) {
      try {
        // Helper: resolve current active contract for this positionId
        const resolveCurrentCid = async (): Promise<{ cid: string; pos: PositionData }> => {
          const results = await sdk!.cantonQuery({
            templateId: TEMPLATE_IDS.POSITION,
            filter: { positionId },
          });
          const active = results.find(c => {
            const s = (c.payload as Record<string, unknown>).status as string;
            return s === 'Open' || s === 'MarginCalled';
          });
          if (!active) throw new Error('Active position not found for ' + positionId);
          return { cid: active.contractId, pos: contractToPosition(active) };
        };

        let { cid: currentCid, pos } = await resolveCurrentCid();

        // Compute final PnL and closing price
        const prices = await fetchLivePrices();
        const symbol = pos.description.trim().split(/\s+/).pop() || '';
        const currentPrice = prices[symbol] || 0;
        let finalPnL = 0;
        if (pos.entryPrice && pos.units && currentPrice) {
          finalPnL = pos.direction === 'Short'
            ? pos.units * (pos.entryPrice - currentPrice)
            : pos.units * (currentPrice - pos.entryPrice);
        }

        await sdk.cantonExercise({
          contractId: currentCid,
          templateId: TEMPLATE_IDS.POSITION,
          choice: CHOICES.CLOSE_POSITION,
          argument: {
            finalPnL: toDecimal10(finalPnL),
            exitPrice: currentPrice > 0 ? toDecimal10(currentPrice) : null,
          },
        });
        return { data: { success: true } };
      } catch (error) {
        console.warn('Canton close position failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },

  liquidate: async (positionId: string) => {
    if (!sdk) throw new Error('SDK not available');

    // 1. Query Position by positionId to get the current (non-stale) contract.
    //    Contract IDs change on every Daml exercise, so we always resolve fresh.
    const positions = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.POSITION,
      filter: { positionId },
    });
    const posContract = positions.find(c => {
      const s = (c.payload as Record<string, unknown>).status as string;
      return s === 'Open' || s === 'MarginCalled';
    });
    if (!posContract) throw new Error('Active position not found for ' + positionId);

    const pos = contractToPosition(posContract);

    // 2. Validate status
    if (pos.status !== 'Open' && pos.status !== 'MarginCalled') {
      throw new Error(`Position status "${pos.status}" is not liquidatable`);
    }

    // 3. Query BrokerFundLink for broker+fund → get ltvThreshold
    const links = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.BROKER_FUND_LINK,
      filter: { broker: pos.broker, fund: pos.fund },
    });
    if (links.length === 0) throw new Error('BrokerFundLink not found for this position');
    const linkPayload = links[0].payload as Record<string, unknown>;
    const ltvThreshold = typeof linkPayload.ltvThreshold === 'string'
      ? parseFloat(linkPayload.ltvThreshold)
      : (linkPayload.ltvThreshold as number) || 0.8;

    // 4. Verify currentLTV >= ltvThreshold (pre-check; Daml double-checks)
    if (pos.currentLTV < ltvThreshold) {
      throw new Error(`LTV ${(pos.currentLTV * 100).toFixed(1)}% is below threshold ${(ltvThreshold * 100).toFixed(0)}%, cannot liquidate`);
    }

    // 5. Look up vault and compute live collateral value
    const vaults = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.VAULT,
      filter: { vaultId: pos.vaultId },
    });
    let liveCollateralValue = 0;
    if (vaults.length > 0) {
      const vaultLive = await recalcVaultPrices(contractToVault(vaults[0]));
      liveCollateralValue = vaultLive.totalValue;
    }

    // 6. Calculate liquidation amount based on LIVE PnL (not stale on-ledger value)
    //    The on-ledger unrealizedPnL may be 0 if the workflow hasn't updated it yet.
    //    Compute fresh PnL from current market price, same as the position listing does.
    //    - Negative PnL = fund lost money → broker seizes |PnL| from collateral
    //    - Positive PnL = fund is winning → no collateral seizure (just close position)
    //    - Cap at vault's live collateral value (can't seize more than what's in the vault)
    const livePrices = await fetchLivePrices();
    const assetSymbol = pos.description.trim().split(/\s+/).pop() || '';
    const liveAssetPrice = livePrices[assetSymbol] || 0;
    let pnl = pos.unrealizedPnL || 0;
    if (pos.entryPrice && pos.units && liveAssetPrice) {
      pnl = pos.direction === 'Short'
        ? pos.units * (pos.entryPrice - liveAssetPrice)
        : pos.units * (liveAssetPrice - pos.entryPrice);
    }
    const liquidationAmountUSD = pnl < 0
      ? Math.min(Math.abs(pnl), liveCollateralValue)
      : 0;
    console.log(`[Liquidation] Position ${positionId}: live PnL=$${pnl.toFixed(2)}, collateral=$${liveCollateralValue.toFixed(2)}, seizure=$${liquidationAmountUSD.toFixed(2)}`);

    // Prepare liquidation record tracking
    const escrowLiquidations: LiquidationRecord['escrowLiquidations'] = [];
    const ccSeized: LiquidationRecord['ccSeized'] = [];
    const cantonSettlement: LiquidationRecord['cantonSettlement'] = [];
    let brokerRecipient = '';
    let brokerCantonParty = pos.broker || '';
    const liquidatedAt = new Date().toISOString();
    const escrowTxHashes: string[] = [];
    const seizureDebug: string[] = [];  // Track seizure steps for debugging

    seizureDebug.push(`pnl=${pnl.toFixed(2)}, collateral=${liveCollateralValue.toFixed(2)}, seizureAmt=${liquidationAmountUSD.toFixed(2)}, vaults=${vaults.length}`);

    // Only perform seizure if there is an amount owed AND vault exists
    if (liquidationAmountUSD > 0 && vaults.length > 0) {
      const vault = contractToVault(vaults[0]);
      const evmEscrows = vault.chainVaults.filter(cv => isEVMChain(cv.chain));
      const ccAssets = vault.collateralAssets.filter(a => a.assetType === 'CC');
      const cusdcAssets = vault.collateralAssets.filter(a => a.assetType === 'CUSDC');
      // Canton USDC: USDC deposited via Canton (not in EVM escrow)
      const cantonUsdcBal = vault.chainBalancesBySymbol?.['USDC']?.['Canton'] || vault.chainBalancesBySymbol?.['USDC']?.['canton'] || 0;
      const cantonUsdcAssets = cantonUsdcBal > 0
        ? vault.collateralAssets.filter(a => a.assetType === 'USDC').slice(0, 1)
        : [];

      // Get operator/deployer EVM address (bridge recipient for EVM→Canton)
      let operatorEvmAddr: string | undefined;
      // Get broker's EVM address (fallback destination info)
      let brokerEvmAddr: { address: string } | undefined;
      if (evmEscrows.length > 0) {
        const addresses = await sdk.getAddresses();
        brokerEvmAddr = addresses.find(a => a.chainType === 'evm');
        if (!brokerEvmAddr) throw new Error('No EVM address found for broker');
        brokerRecipient = brokerEvmAddr.address;
        // Fetch operator/deployer address as bridge recipient
        try {
          const deployRes = await fetch('/api/escrow/deploy');
          const deployData = await deployRes.json() as { deployerAddress?: string };
          operatorEvmAddr = deployData.deployerAddress;
        } catch {
          // Fallback: use broker address if deployer unavailable
        }
      }

      // ── Phase 1: Inventory ──────────────────────────────────────────
      // Read all available balances before seizing anything.
      // Priority order: USDC (1:1, no slippage) → CC → ETH (volatile, swap slippage)
      type SeizableAsset = {
        type: 'USDC' | 'ETH' | 'CC' | 'CUSDC' | 'USDC_CANTON';
        priority: number;
        chain?: string;
        chainId?: number;
        escrowAddress?: string;
        balanceWei?: bigint;
        balanceNum?: number;
        valueUSD: number;
        price: number;
        assetId?: string;
        usdcTokenAddress?: string;
      };
      const inventory: SeizableAsset[] = [];
      const ethPrice = await getLivePrice('ETH');
      const ccPrice = await getLivePrice('CC');

      // EVM escrows: read on-chain ETH + USDC balances
      for (const escrow of evmEscrows) {
        const chainId = CHAIN_NAME_TO_ID[escrow.chain] || getDefaultChainId();
        const chainConfig = CHAIN_CONFIG[chainId];
        try {
          const balRes = await fetch(`/api/escrow/balances?addresses=${escrow.custodyAddress}&chainIds=${chainId}`);
          const balData = await balRes.json() as { balances?: Array<{ eth: string; usdc: string }> };
          const bal = balData.balances?.[0];

          // USDC inventory
          const usdcBal = BigInt(bal?.usdc || '0');
          if (usdcBal > BigInt(0) && chainConfig?.usdc) {
            inventory.push({
              type: 'USDC', priority: 0,
              chain: escrow.chain, chainId, escrowAddress: escrow.custodyAddress,
              balanceWei: usdcBal,
              valueUSD: Number(usdcBal) / 1e6, // USDC = 6 decimals, 1:1 USD
              price: 1,
              usdcTokenAddress: chainConfig.usdc,
            });
          }

          // ETH inventory (priority 3 — last resort, requires swap)
          const ethBal = BigInt(bal?.eth || '0');
          if (ethBal > BigInt(0)) {
            inventory.push({
              type: 'ETH', priority: 3,
              chain: escrow.chain, chainId, escrowAddress: escrow.custodyAddress,
              balanceWei: ethBal,
              valueUSD: Number(ethBal) / 1e18 * ethPrice,
              price: ethPrice,
            });
          }
        } catch (err) {
          console.warn(`[Liquidation] Balance read failed for ${escrow.chain}:`, err);
        }
      }

      // CUSDC inventory (priority 1 — Canton-native stablecoin, 1:1 USD)
      for (const cusdcAsset of cusdcAssets) {
        inventory.push({
          type: 'CUSDC', priority: 1,
          balanceNum: cusdcAsset.amount,
          valueUSD: cusdcAsset.amount, // 1:1 USD
          price: 1,
          assetId: cusdcAsset.assetId,
        });
      }

      // Canton USDC inventory (priority 0.5 — stablecoin, 1:1 USD, no EVM gas)
      for (const usdcAsset of cantonUsdcAssets) {
        inventory.push({
          type: 'USDC_CANTON', priority: 0,
          balanceNum: Math.min(usdcAsset.amount, cantonUsdcBal),
          valueUSD: Math.min(usdcAsset.amount, cantonUsdcBal), // 1:1 USD
          price: 1,
          assetId: usdcAsset.assetId,
        });
      }

      // CC inventory (priority 2)
      for (const ccAsset of ccAssets) {
        const value = ccAsset.amount * ccPrice;
        inventory.push({
          type: 'CC', priority: 2,
          balanceNum: ccAsset.amount,
          valueUSD: value,
          price: ccPrice,
          assetId: ccAsset.assetId,
        });
      }

      // Sort by priority: USDC_CANTON/USDC (0) → CUSDC (1) → CC (2) → ETH (3)
      inventory.sort((a, b) => a.priority - b.priority);
      seizureDebug.push(`inventory: ${inventory.map(i => `${i.type}=$${i.valueUSD.toFixed(2)}`).join(', ') || 'EMPTY'}`);

      // ── Phase 2: Plan ───────────────────────────────────────────────
      // Walk inventory and compute how much of each asset to seize.
      type SeizurePlan = SeizableAsset & { seizeUSD: number; seizeWei?: bigint; seizeNum?: number };
      const seizurePlan: SeizurePlan[] = [];
      let remainingDebt = liquidationAmountUSD;

      for (const asset of inventory) {
        if (remainingDebt <= 0) break;
        const seizeUSD = Math.min(asset.valueUSD, remainingDebt);

        if (asset.type === 'USDC_CANTON') {
          // Canton USDC: decimal amount, 1:1 USD (same as CUSDC handling)
          const seizeNum = seizeUSD >= asset.valueUSD
            ? asset.balanceNum!
            : seizeUSD / asset.price;
          seizurePlan.push({ ...asset, seizeUSD, seizeNum });
        } else if (asset.type === 'USDC') {
          // USDC: 6 decimals, 1:1 USD
          const seizeWei = seizeUSD >= asset.valueUSD
            ? asset.balanceWei! // take full balance if covering full value (avoid rounding dust)
            : BigInt(Math.floor(seizeUSD * 1e6));
          seizurePlan.push({ ...asset, seizeUSD, seizeWei });
        } else if (asset.type === 'ETH') {
          // ETH: 18 decimals
          const seizeWei = seizeUSD >= asset.valueUSD
            ? asset.balanceWei!
            : BigInt(Math.floor(seizeUSD / ethPrice * 1e18));
          seizurePlan.push({ ...asset, seizeUSD, seizeWei });
        } else if (asset.type === 'CC' || asset.type === 'CUSDC') {
          // CC / CUSDC: decimal amount
          const seizeNum = seizeUSD >= asset.valueUSD
            ? asset.balanceNum!
            : seizeUSD / asset.price;
          seizurePlan.push({ ...asset, seizeUSD, seizeNum });
        }

        remainingDebt -= seizeUSD;
      }

      // ── Phase 3: Execute ────────────────────────────────────────────
      // Track per-escrow records for the LiquidationRecord
      const escrowRecordMap = new Map<string, LiquidationRecord['escrowLiquidations'][0]>();

      // Helper: bridge EVM USDC to Canton — transfer operator's existing CUSDC to broker
      const bridgeToCanton = async (bridgeAmountUSD: number) => {
        if (bridgeAmountUSD <= 0) return;
        try {
          // Transfer CUSDC from operator/custodian to broker via custodian withdraw
          await fetch('/api/custodian/withdraw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ receiverParty: pos.broker, amount: bridgeAmountUSD }),
          });
          cantonSettlement.push({
            symbol: 'CUSDC', amount: bridgeAmountUSD,
            valueUSD: bridgeAmountUSD, source: 'bridge',
          });
          console.log(`[Liquidation] Bridged ${bridgeAmountUSD} CUSDC to broker on Canton`);
        } catch (err) {
          console.warn('[Liquidation] Canton bridge failed:', err);
        }
      };

      // EVM seizure destination: operator bridge address (falls back to broker EVM)
      const evmRecipient = operatorEvmAddr || brokerEvmAddr!.address;

      for (const plan of seizurePlan) {
        if (plan.type === 'USDC' && plan.seizeWei && plan.seizeWei > BigInt(0)) {
          const key = `${plan.chainId}-${plan.escrowAddress}`;
          if (!escrowRecordMap.has(key)) {
            escrowRecordMap.set(key, {
              chain: CHAIN_ID_TO_NAME[plan.chainId!] || plan.chain!,
              custodyAddress: plan.escrowAddress!,
              ethSeized: '0', ethValueUSD: 0, usdcSeized: '0', txHashes: [],
            });
          }
          const record = escrowRecordMap.get(key)!;
          record.usdcSeized = (Number(plan.seizeWei) / 1e6).toFixed(2);
          // Send USDC to operator bridge address (not broker EVM)
          const callData = encodeLiquidateERC20(plan.usdcTokenAddress!, evmRecipient, plan.seizeWei);
          try {
            const txResult = await sdk.sendContractCall(plan.escrowAddress!, callData, plan.chainId!);
            escrowTxHashes.push(txResult.transactionHash);
            record.txHashes.push(txResult.transactionHash);
            console.log(`[Liquidation] USDC seized $${plan.seizeUSD.toFixed(2)} on chain ${plan.chainId}:`, txResult.transactionHash);
            // Bridge: mint equivalent CUSDC on Canton and transfer to broker
            await bridgeToCanton(plan.seizeUSD);
          } catch (err) {
            console.warn(`[Liquidation] USDC seizure failed on chain ${plan.chainId}:`, err);
          }

        } else if (plan.type === 'ETH' && plan.seizeWei && plan.seizeWei > BigInt(0)) {
          const key = `${plan.chainId}-${plan.escrowAddress}`;
          if (!escrowRecordMap.has(key)) {
            escrowRecordMap.set(key, {
              chain: CHAIN_ID_TO_NAME[plan.chainId!] || plan.chain!,
              custodyAddress: plan.escrowAddress!,
              ethSeized: '0', ethValueUSD: 0, usdcSeized: '0', txHashes: [],
            });
          }
          const record = escrowRecordMap.get(key)!;
          record.ethSeized = (Number(plan.seizeWei) / 1e18).toFixed(6);
          record.ethValueUSD = plan.seizeUSD;
          // amountOutMin: testnet=0 (low Uniswap liquidity), mainnet=98% of seized USD value in USDC
          const amountOutMin = getNetworkMode() === 'testnet'
            ? BigInt(0)
            : BigInt(Math.round(plan.seizeUSD * 0.98 * 1e6));
          // Send swapped USDC to operator bridge address (not broker EVM)
          const callData = encodeLiquidateETH(evmRecipient, plan.seizeWei, amountOutMin);
          try {
            const txResult = await sdk.sendContractCall(plan.escrowAddress!, callData, plan.chainId!);
            escrowTxHashes.push(txResult.transactionHash);
            record.txHashes.push(txResult.transactionHash);
            console.log(`[Liquidation] ETH seized $${plan.seizeUSD.toFixed(2)} on chain ${plan.chainId}:`, txResult.transactionHash);
            // Bridge: mint equivalent CUSDC on Canton and transfer to broker
            await bridgeToCanton(plan.seizeUSD);
          } catch (err) {
            console.warn(`[Liquidation] ETH seizure failed on chain ${plan.chainId}:`, err);
          }

        } else if (plan.type === 'USDC_CANTON' && plan.seizeNum && plan.seizeNum > 0) {
          // Canton USDC: record seizure, vault depletion handled by SeizeCollateral below
          try {
            // Transfer via Canton JSON API (USDCHolding Split+Transfer)
            const withdrawRes = await fetch('/api/custodian/withdraw-usdc', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ receiverParty: pos.broker, amount: plan.seizeNum }),
            });
            const withdrawData = await withdrawRes.json() as { success?: boolean; error?: string };
            if (!withdrawRes.ok || !withdrawData.success) {
              console.warn(`[Liquidation] Canton USDC transfer to broker failed:`, withdrawData.error);
            } else {
              console.log(`[Liquidation] Canton USDC transferred to broker: ${plan.seizeNum} USDC`);
            }
          } catch (err) {
            console.warn(`[Liquidation] Canton USDC custodian transfer error:`, err);
          }

          ccSeized.push({ symbol: 'USDC', amount: plan.seizeNum, valueUSD: plan.seizeUSD });
          cantonSettlement.push({ symbol: 'USDC', amount: plan.seizeNum, valueUSD: plan.seizeUSD, source: 'direct' });

        } else if ((plan.type === 'CC' || plan.type === 'CUSDC') && plan.seizeNum && plan.seizeNum > 0) {
          // CC/CUSDC: record seizure, vault depletion handled by SeizeCollateral below
          try {
            const withdrawRes = await fetch('/api/custodian/withdraw', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ receiverParty: pos.broker, amount: plan.seizeNum }),
            });
            const withdrawData = await withdrawRes.json() as { success?: boolean; error?: string };
            if (!withdrawRes.ok || !withdrawData.success) {
              console.warn(`[Liquidation] ${plan.type} transfer to broker failed:`, withdrawData.error);
            } else {
              console.log(`[Liquidation] ${plan.type} transferred to broker: ${plan.seizeNum} ${plan.type}`);
            }
          } catch (err) {
            console.warn(`[Liquidation] ${plan.type} custodian transfer error:`, err);
          }

          ccSeized.push({ symbol: plan.type, amount: plan.seizeNum, valueUSD: plan.seizeUSD });
          cantonSettlement.push({ symbol: plan.type, amount: plan.seizeNum, valueUSD: plan.seizeUSD, source: 'direct' });
        }
      }

      // Collect escrow records for LiquidationRecord
      for (const record of escrowRecordMap.values()) {
        escrowLiquidations.push(record);
      }

      // Exercise SeizeCollateral (operator-controlled) to deplete vault ledger for ALL seized assets.
      // WithdrawAsset requires controller=owner (fund) which the broker can't exercise.
      // SeizeCollateral requires controller=operator which is available via actAs.
      const seizedVaultAssets: Array<{ assetId: string; amount: number; valueUSD: number }> = [];
      for (const plan of seizurePlan) {
        if (plan.seizeUSD <= 0) continue;
        if (plan.assetId) {
          // Canton-native: CC, CUSDC, USDC_CANTON — assetId comes directly from inventory
          seizedVaultAssets.push({ assetId: plan.assetId, amount: plan.seizeNum || 0, valueUSD: plan.seizeUSD });
        } else if (plan.type === 'USDC' || plan.type === 'ETH') {
          // EVM assets: map type back to vault collateralAssets entry by symbol prefix
          const symbol = plan.type;
          const vaultEntry = vault.collateralAssets.find(a => a.assetId.split('-')[0].toUpperCase() === symbol);
          if (vaultEntry) {
            const seizedAmount = plan.type === 'USDC'
              ? Number(plan.seizeWei || 0n) / 1e6
              : Number(plan.seizeWei || 0n) / 1e18;
            seizedVaultAssets.push({ assetId: vaultEntry.assetId, amount: seizedAmount, valueUSD: plan.seizeUSD });
          }
        }
      }

      seizureDebug.push(`seizedVaultAssets: ${seizedVaultAssets.map(s => `${s.assetId}=${s.amount}`).join(', ') || 'EMPTY'}`);

      if (seizedVaultAssets.length > 0) {
        // Exercise SeizeCollateral via server-side endpoint (the vault's operator
        // is the custodian party, which the wallet SDK can't actAs).
        const freshVaults = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.VAULT,
          filter: { vaultId: pos.vaultId },
        });
        let vaultCid = freshVaults[0]?.contractId;

        if (vaultCid) {
          for (const seized of seizedVaultAssets) {
            try {
              const seizeRes = await fetch('/api/canton/seize-collateral', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contractId: vaultCid,
                  templateId: TEMPLATE_IDS.VAULT,
                  assetId: seized.assetId,
                  seizeAmount: seized.amount.toString(),
                  reason: `Liquidation of position ${pos.positionId}`,
                }),
              });
              const seizeData = await seizeRes.json() as { success?: boolean; newContractId?: string; error?: string };
              if (seizeData.success && seizeData.newContractId) {
                vaultCid = seizeData.newContractId;
              }
              if (seizeData.success) {
                seizureDebug.push(`SEIZED: ${seized.assetId} ${seized.amount} ($${seized.valueUSD.toFixed(2)})`);
              } else {
                seizureDebug.push(`SEIZE_FAIL: ${seized.assetId} → ${seizeData.error || seizeRes.status}`);
              }
            } catch (err) {
              seizureDebug.push(`SEIZE_ERROR: ${seized.assetId} → ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
      }
    }
    const escrowTxHash = escrowTxHashes[0];

    // 10. Store liquidation record
    liquidationRecords.set(pos.positionId, {
      positionId: pos.positionId,
      liquidatedAt,
      liquidationAmountUSD,
      pnl,
      collateralValueAtLiquidation: liveCollateralValue,
      ltvAtLiquidation: pos.currentLTV,
      ltvThreshold,
      escrowLiquidations,
      ccSeized,
      cantonSettlement,
      brokerRecipient,
      brokerCantonParty,
    });

    // 11. Snapshot PnL, then exercise LiquidatePosition on Canton
    //     LiquidatePosition has `controller operator` so we must include the
    //     operator party in actAs even when the broker initiates the call.
    //     Use the position's actual operator (may differ from config operator).
    const actAsParties = pos.operator ? [pos.operator] : [];

    // Helper: resolve the current active contract ID for this positionId
    const resolveCurrentCid = async (): Promise<string> => {
      const fresh = await sdk!.cantonQuery({
        templateId: TEMPLATE_IDS.POSITION,
        filter: { positionId },
      });
      const active = fresh.find(c => {
        const s = (c.payload as Record<string, unknown>).status as string;
        return s === 'Open' || s === 'MarginCalled';
      });
      if (!active) throw new Error('Position no longer active (may have been liquidated by workflow)');
      return active.contractId;
    };

    // Resolve the current contract and compute closing price
    const activeContractId = await resolveCurrentCid();
    const prices = await fetchLivePrices();
    const symbol = pos.description.trim().split(/\s+/).pop() || '';
    const currentPrice = prices[symbol] || 0;

    await sdk.cantonExercise({
      contractId: activeContractId,
      templateId: TEMPLATE_IDS.POSITION,
      choice: CHOICES.LIQUIDATE_POSITION,
      argument: {
        ltvThreshold: toDecimal10(ltvThreshold),
        liquidatedAmount: toDecimal10(liquidationAmountUSD),
        liquidatedAt,
        finalPnL: toDecimal10(pnl),
        exitPrice: currentPrice > 0 ? toDecimal10(currentPrice) : null,
      },
      actAs: actAsParties,
    });

    // 12. Return result
    return {
      data: {
        success: true,
        liquidatedAmount: liquidationAmountUSD,
        escrowTxHash,
        seizureDebug,
      },
    };
  },

  getLiquidationRecord: (positionId: string): LiquidationRecord | undefined => {
    return liquidationRecords.get(positionId);
  },
};

// Workflow Margin Call API
export interface WorkflowMarginCallData {
  contractId: string;
  operator: string;
  fund: string;
  broker: string;
  positionId: string;
  vaultId: string;
  requiredAmount: number;
  currentLTV: number;
  ltvThreshold: number;
  callTime: string;
  status: string;
}

export const workflowMarginCallAPI = {
  list: async () => {
    if (sdk) {
      try {
        const contracts = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.WORKFLOW_MARGIN_CALL,
        });
        return {
          data: contracts.map((c) => {
            const p = c.payload as Record<string, unknown>;
            return {
              contractId: c.contractId,
              operator: p.operator as string,
              fund: p.fund as string,
              broker: p.broker as string,
              positionId: p.positionId as string,
              vaultId: p.vaultId as string,
              requiredAmount: typeof p.requiredAmount === 'string' ? parseFloat(p.requiredAmount) : (p.requiredAmount as number) || 0,
              currentLTV: typeof p.currentLTV === 'string' ? parseFloat(p.currentLTV) : (p.currentLTV as number) || 0,
              ltvThreshold: typeof p.ltvThreshold === 'string' ? parseFloat(p.ltvThreshold) : (p.ltvThreshold as number) || 0,
              callTime: p.callTime as string,
              status: p.status as string,
            };
          }),
        };
      } catch (error) {
        console.warn('Canton query workflow margin calls failed:', error);
      }
    }
    return { data: [] };
  },

  acknowledge: async (contractId: string) => {
    if (sdk) {
      try {
        await sdk.cantonExercise({
          contractId,
          templateId: TEMPLATE_IDS.WORKFLOW_MARGIN_CALL,
          choice: CHOICES.ACKNOWLEDGE_MARGIN_CALL,
          argument: {},
        });
        return { data: { success: true } };
      } catch (error) {
        console.warn('Canton acknowledge margin call failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },
};
