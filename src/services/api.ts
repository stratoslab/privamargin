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
  encodeWithdrawETH, encodeWithdrawERC20, encodeLiquidateETH,
  encodeForwardETH, encodeForwardERC20,
  CHAIN_CONFIG, CHAIN_NAME_TO_ID, CHAIN_ID_TO_NAME,
  getDefaultChainId, NETWORK_MODE,
} from './evmEscrow';

// Truncate a number to 10 decimal places for Daml Numeric 10
function toDecimal10(n: number): string {
  const s = n.toFixed(10);
  return s.replace(/\.?0+$/, '') || '0';
}

// CPCV Package ID (deterministic hash - same across all participant nodes)
// Must match the DAR file: daml/.daml/dist/cpcv-0.0.1.dar
const CPCV_PACKAGE_ID = '4a9840c0f6177ff757bdfc1d1c7f90cc2f7510d34d7c974d03c28d2f8eb18f30';

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
  positionId: string;
  status: 'Sufficient' | 'Insufficient';
  proof: string;
  timestamp: string;
}

// Map UI asset type strings to Daml AssetType enum
// Canton JSON API expects simple string for enums
function mapAssetTypeToEnum(assetType: string): string {
  if (assetType === 'USDC' || assetType === 'USDT' || assetType === 'CUSD') {
    return 'Stablecoin';
  }
  if (assetType === 'CC') {
    return 'CantonCoin';
  }
  // BTC, ETH, SOL, TRX, TON are all crypto
  return 'Cryptocurrency';
}

// Fallback asset prices (wallet SDK supported tokens only)
const FALLBACK_PRICES: Record<string, number> = {
  'BTC': 95000,
  'ETH': 3500,
  'SOL': 180,
  'CC': 0.158,
  'USDC': 1,
  'USDT': 1,
  'TRX': 0.25,
  'TON': 5.50,
  'CUSD': 1,
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
    for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
      if (data[geckoId]?.usd) {
        prices[symbol] = data[geckoId].usd;
      }
    }
    livePriceCache = prices;
    livePriceCacheTime = now;
    return livePriceCache;
  } catch (err) {
    console.warn('Failed to fetch live prices from CoinGecko, using fallback:', err);
  }
  return FALLBACK_PRICES;
}

// Get live price for a symbol
export async function getLivePrice(symbol: string): Promise<number> {
  const prices = await fetchLivePrices();
  return prices[symbol] || FALLBACK_PRICES[symbol] || 1;
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

// Generate a mock ZK proof
function generateZKProof(): string {
  const proofData = {
    commitment: btoa(Math.random().toString(36)),
    challenge: btoa(Math.random().toString(36)),
    response: btoa(Math.random().toString(36)),
    timestamp: Date.now(),
  };
  return btoa(JSON.stringify(proofData));
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

  return {
    vaultId: payload.vaultId as string,
    owner: payload.owner as string,
    collateralAssets,
    totalValue,
    linkedPositions: (payload.linkedPositions as string[]) || [],
    chainVaults,
    depositRecords,
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

// Vault API
export const vaultAPI = {
  create: async (owner: string, vaultId: string, initialAssets?: Array<{ assetType: string; amount: number }>) => {
    // Try SDK first
    if (sdk) {
      try {
        // Use dedicated custodian party for vault custody; fallback to operator or owner
        const operatorParty = await getCustodianParty() || await getOperatorParty() || owner;

        // Step 1: Create the vault with operator as custodian
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
  depositReal: async (vaultId: string, symbol: string, amount: number, chain: string) => {
    if (!sdk) throw new Error('SDK not available');

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
    const evmChainNames = ['Ethereum', 'Sepolia', 'Base'];
    const matchingEscrow = vault.chainVaults.find(cv =>
      evmChainNames.includes(cv.chain) && chain === 'evm'
    );

    let txId: string | undefined;
    if (matchingEscrow && chain === 'evm') {
      // EVM path: send native ETH — route through relay if available, else direct to escrow
      const chainId = CHAIN_NAME_TO_ID[matchingEscrow.chain] || getDefaultChainId();
      const amountWei = '0x' + BigInt(Math.round(amount * 1e18)).toString(16);
      const chainConfig = CHAIN_CONFIG[chainId];
      const destination = chainConfig?.relay || matchingEscrow.custodyAddress;
      const evmResult = await sdk.sendEVMTransaction({
        transaction: {
          to: destination,
          value: amountWei,
          chainId,
        },
      });
      console.log(chainConfig?.relay ? 'Relay deposit result:' : 'EVM escrow deposit result:', evmResult);
      txId = evmResult.transactionHash;
    } else {
      // Canton path: transfer to custodian party
      const custodianParty = await getCustodianParty() || operator;
      const transferResult = await sdk.transfer({
        to: custodianParty,
        amount: amount.toString(),
        symbol,
        chain: chain as 'canton' | 'evm' | 'svm' | 'btc' | 'tron' | 'ton',
      });
      console.log('Transfer result:', transferResult);
      txId = (transferResult as { txId?: string }).txId;
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
        chain,
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
      } catch (error) {
        console.warn('Canton query failed, using mock:', error);
      }
    }

    // Fallback to mock
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
        if (contracts.length > 0) {
          const vaults = contracts.map(contractToVault);
          return { data: await Promise.all(vaults.map(recalcVaultPrices)) };
        }
      } catch (error) {
        console.warn('Canton query failed, using mock:', error);
      }
    }

    const ownerVaults = Array.from(mockVaults.values()).filter(v => v.owner === party);
    return { data: await Promise.all(ownerVaults.map(recalcVaultPrices)) };
  },

  // Deploy an EVM escrow contract for a vault and register it on Canton
  deployEVMEscrow: async (vaultId: string, chainId: number, liquidatorAddress?: string) => {
    if (!sdk) throw new Error('SDK not available');

    // Step 1: Resolve liquidator address (default: operator's EVM address)
    let liquidator = liquidatorAddress;
    if (!liquidator) {
      const addresses = await sdk.getAddresses();
      const evmAddr = addresses.find(a => a.chainType === 'evm');
      if (evmAddr) {
        liquidator = evmAddr.address;
      } else {
        throw new Error('No EVM address found for liquidator');
      }
    }

    // Step 2: Deploy escrow contract on EVM chain (with Uniswap V3 swap config)
    const chainConfig = CHAIN_CONFIG[chainId];
    if (!chainConfig) throw new Error(`Unsupported chain ${chainId} — no Uniswap V3 config available`);
    const { contractAddress, txHash } = await deployEscrowContract(sdk, chainId, liquidator, chainConfig.swapRouter, chainConfig.weth, chainConfig.usdc);

    // Step 2: Register the escrow address on the Daml vault via RegisterChainVault
    const vaults = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.VAULT,
      filter: { vaultId }
    });
    if (vaults.length === 0) throw new Error('Vault not found');

    const chainName = CHAIN_ID_TO_NAME[chainId] || `EVM-${chainId}`;

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
  withdrawFromEscrow: async (vaultId: string, chain: string, amountWei: string, tokenAddress?: string) => {
    if (!sdk) throw new Error('SDK not available');

    // Get vault to find escrow address and user's EVM address
    const vaults = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.VAULT,
      filter: { vaultId }
    });
    if (vaults.length === 0) throw new Error('Vault not found');
    const vault = contractToVault(vaults[0]);

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
    return { data: { txHash: result.transactionHash, status: result.status } };
  },

  // Deploy a DepositRelay contract for a chain (operator only, one per chain)
  deployDepositRelay: async (chainId: number) => {
    if (!sdk) throw new Error('SDK not available');

    const addresses = await sdk.getAddresses();
    const evmAddr = addresses.find(a => a.chainType === 'evm');
    if (!evmAddr) throw new Error('No EVM address found for operator');

    const { contractAddress, txHash } = await deployDepositRelay(sdk, chainId, evmAddr.address);

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
  verify: async (positionId: string, _vaultId: string, requiredMargin: number, collateralValue: number) => {
    const status = collateralValue >= requiredMargin ? 'Sufficient' : 'Insufficient';
    const proof = generateZKProof();

    const result: VerificationResult = {
      positionId,
      status,
      proof,
      timestamp: new Date().toISOString(),
    };

    // Note: Creating MarginCall directly requires all signatories (provider, counterparty, operator)
    // In a real system, this would go through a proper workflow. For demo, we skip Canton creation
    // and just use mock data since multi-party contract creation requires coordination.
    if (status === 'Insufficient') {
      console.log('Margin insufficient - mock margin call created (Canton multi-party contracts require workflow)');
    }

    mockVerifications.set(positionId, result);

    // If insufficient, create a margin call (mock)
    if (status === 'Insufficient') {
      const marginCall: MarginCall = {
        id: `MC-${Date.now()}`,
        positionId,
        requiredAmount: requiredMargin - collateralValue,
        provider: 'Current User',
        counterparty: 'Counterparty',
        status: 'Active',
        createdAt: new Date().toISOString(),
      };
      mockMarginCalls.set(marginCall.id, marginCall);
    }

    return { data: result };
  },

  getStatus: async (positionId: string) => {
    const result = mockVerifications.get(positionId);
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
            console.log('[linkAPI] BrokerFundLink payload allowedAssets:', JSON.stringify(p.allowedAssets));
            return {
              contractId: c.contractId,
              broker: p.broker as string,
              fund: p.fund as string,
              operator: p.operator as string,
              linkId: p.linkId as string,
              ltvThreshold: typeof rawThreshold === 'string' ? parseFloat(rawThreshold) : (rawThreshold as number) || 0.8,
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
            console.log('[linkAPI] BrokerFundLink payload for fund allowedAssets:', JSON.stringify(p.allowedAssets));
            return {
              contractId: c.contractId,
              broker: p.broker as string,
              fund: p.fund as string,
              operator: p.operator as string,
              linkId: p.linkId as string,
              ltvThreshold: typeof rawThreshold === 'string' ? parseFloat(rawThreshold) : (rawThreshold as number) || 0.8,
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
  currentThreshold: number;
  proposalId: string;
  createdAt: string;
}

function contractToProposal(c: CantonContract<Record<string, unknown>>): LTVChangeProposalData {
  const p = c.payload as Record<string, unknown>;
  return {
    contractId: c.contractId,
    broker: p.broker as string,
    fund: p.fund as string,
    operator: p.operator as string,
    linkContractId: p.linkContractId as string,
    proposedThreshold: typeof p.proposedThreshold === 'string' ? parseFloat(p.proposedThreshold) : (p.proposedThreshold as number) || 0,
    currentThreshold: typeof p.currentThreshold === 'string' ? parseFloat(p.currentThreshold) : (p.currentThreshold as number) || 0,
    proposalId: p.proposalId as string,
    createdAt: p.createdAt as string,
  };
}

export const proposalAPI = {
  propose: async (linkContractId: string, proposedThreshold: number, _currentThreshold: number) => {
    if (sdk) {
      try {
        const proposalId = `LTV-${Date.now()}`;
        const result = await sdk.cantonExercise({
          contractId: linkContractId,
          templateId: TEMPLATE_IDS.BROKER_FUND_LINK,
          choice: CHOICES.PROPOSE_LTV_CHANGE,
          argument: {
            proposedThreshold: toDecimal10(proposedThreshold),
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
            await positionAPI.close(pos.contractId);
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
  direction: 'Long' | 'Short';
  notionalValue: number;
  entryPrice: number;
  units: number;
  unrealizedPnL: number;
  collateralValue: number;
  currentLTV: number;
  status: string;
  createdAt: string;
  lastChecked: string;
}

function parseDecimal(v: unknown): number {
  if (typeof v === 'string') return parseFloat(v) || 0;
  return (v as number) || 0;
}

function contractToPosition(c: CantonContract<Record<string, unknown>>): PositionData {
  const p = c.payload as Record<string, unknown>;
  // direction is Optional PositionDirection — could be null, "Long", "Short"
  const rawDir = p.direction;
  const direction: 'Long' | 'Short' = rawDir === 'Short' ? 'Short' : 'Long';

  return {
    contractId: c.contractId,
    fund: p.fund as string,
    broker: p.broker as string,
    operator: p.operator as string,
    positionId: p.positionId as string,
    vaultId: p.vaultId as string,
    description: p.description as string,
    direction,
    notionalValue: parseDecimal(p.notionalValue),
    entryPrice: parseDecimal(p.entryPrice),
    units: parseDecimal(p.units),
    unrealizedPnL: parseDecimal(p.unrealizedPnL),
    collateralValue: parseDecimal(p.collateralValue),
    currentLTV: parseDecimal(p.currentLTV),
    status: p.status as string,
    createdAt: p.createdAt as string,
    lastChecked: p.lastChecked as string,
  };
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

        const currentLTV = collateralValue > 0 ? notionalValue / collateralValue : 0;
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
            collateralValue: toDecimal10(collateralValue),
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
        return { data: contracts.map(contractToPosition) };
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
        return { data: contracts.map(contractToPosition) };
      } catch (error) {
        console.warn('Canton query positions failed:', error);
      }
    }
    return { data: [] };
  },

  close: async (contractId: string) => {
    if (sdk) {
      try {
        await sdk.cantonExercise({
          contractId,
          templateId: TEMPLATE_IDS.POSITION,
          choice: CHOICES.CLOSE_POSITION,
          argument: {},
        });
        return { data: { success: true } };
      } catch (error) {
        console.warn('Canton close position failed:', error);
        throw error;
      }
    }
    throw new Error('SDK not available');
  },

  liquidate: async (contractId: string) => {
    if (!sdk) throw new Error('SDK not available');

    // 1. Query Position to get fund, broker, vaultId, currentLTV, notionalValue, collateralValue, status
    const positions = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.POSITION,
    });
    const posContract = positions.find(c => c.contractId === contractId);
    if (!posContract) throw new Error('Position not found');

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

    // 5. Calculate liquidation amount = min(notionalValue, collateralValue)
    const liquidationAmountUSD = Math.min(pos.notionalValue, pos.collateralValue);

    // 6. Look up vault's EVM escrow → escrow address + chain
    const vaults = await sdk.cantonQuery({
      templateId: TEMPLATE_IDS.VAULT,
      filter: { vaultId: pos.vaultId },
    });
    let escrowTxHash: string | undefined;

    if (vaults.length > 0) {
      const vault = contractToVault(vaults[0]);
      const evmChainNames = ['Ethereum', 'Sepolia', 'Base'];
      const escrow = vault.chainVaults.find(cv => evmChainNames.includes(cv.chain));

      if (escrow) {
        // 7. Convert liquidationAmount (USD) to ETH using live price
        const ethPrice = await getLivePrice('ETH');
        const liquidationETH = liquidationAmountUSD / ethPrice;
        const amountWei = BigInt(Math.round(liquidationETH * 1e18));

        // 8. Get broker's EVM address (destination for liquidated funds)
        const addresses = await sdk.getAddresses();
        const brokerEvmAddr = addresses.find(a => a.chainType === 'evm');
        if (!brokerEvmAddr) throw new Error('No EVM address found for broker');

        // 9. Encode liquidate(brokerEvmAddress, amountWei, amountOutMin)
        //    Mainnet: 98% of expected USDC (2% slippage tolerance, USDC has 6 decimals)
        //    Testnet: 0 (Sepolia Uniswap pools have minimal liquidity)
        const amountOutMin = NETWORK_MODE === 'testnet'
          ? BigInt(0)
          : BigInt(Math.round(liquidationAmountUSD * 0.98 * 1e6));
        const callData = encodeLiquidateETH(brokerEvmAddr.address, amountWei, amountOutMin);

        // 10. Send tx via sendContractCall
        const chainId = CHAIN_NAME_TO_ID[escrow.chain] || getDefaultChainId();

        try {
          const txResult = await sdk.sendContractCall(escrow.custodyAddress, callData, chainId);
          escrowTxHash = txResult.transactionHash;
          console.log('[Liquidation] EVM tx sent:', escrowTxHash);
        } catch (err) {
          console.warn('[Liquidation] EVM tx failed (continuing with Daml update):', err);
        }
      }
    }

    // 11. Exercise LiquidatePosition on Canton
    await sdk.cantonExercise({
      contractId,
      templateId: TEMPLATE_IDS.POSITION,
      choice: CHOICES.LIQUIDATE_POSITION,
      argument: {
        ltvThreshold: toDecimal10(ltvThreshold),
        liquidatedAmount: toDecimal10(liquidationAmountUSD),
        liquidatedAt: new Date().toISOString(),
      },
    });

    // 12. Return result
    return {
      data: {
        success: true,
        liquidatedAmount: liquidationAmountUSD,
        escrowTxHash,
      },
    };
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
