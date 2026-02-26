/**
 * LTV Monitor — Browser-side polling via Stratos SDK
 *
 * Replaces the Cloudflare Workers cron workflow that couldn't reach Canton.
 * Called from the Operator Dashboard every 30 seconds.
 */

import { getSDK } from '@stratos-wallet/sdk';
import {
  TEMPLATE_IDS, CHOICES, fetchLivePrices, toDecimal10,
  FALLBACK_PRICES, getOperatorParty,
} from './api';

// Re-export the run record type so Dashboard can use it
export interface WorkflowRunRecord {
  timestamp: string;
  processed: number;
  marginCallsCreated: number;
  errors: string[];
  positions: Array<{
    positionId: string;
    vaultId: string;
    fund: string;
    broker: string;
    notional: number;
    collateralValue: number;
    pnl: number;
    currentLTV: number;
    breached: boolean;
    autoLiquidated: boolean;
  }>;
  prices: { CC: number; ETH: number; BTC: number; USDC: number; SOL: number };
}

// ---------- Internal types ----------

interface PositionPayload {
  fund: string;
  broker: string;
  operator: string;
  positionId: string;
  vaultId: string;
  description: string;
  notionalValue: string;
  currentLTV: string;
  status: string;
  createdAt: string;
  lastChecked: string;
  direction: string | null;
  entryPrice: string | null;
  units: string | null;
  unrealizedPnL: string | null;
}

interface VaultAsset {
  assetId: string;
  assetType: string;
  amount: string;
  valueUSD: string;
}

interface VaultPayload {
  owner: string;
  operator: string;
  vaultId: string;
  collateralAssets: VaultAsset[];
  linkedPositions: string[];
}

interface LinkPayload {
  broker: string;
  fund: string;
  operator: string;
  linkId: string;
  ltvThreshold: string;
  leverageRatio: string | null;
  isActive: boolean;
  linkedAt: string;
}

interface LTVResult {
  contractId: string;
  positionId: string;
  vaultId: string;
  fund: string;
  broker: string;
  operator: string;
  status: string;
  notional: number;
  collateralValue: number;
  pnl: number;
  currentLTV: number;
}

// CoinGecko ID mapping (for asset symbol resolution from descriptions)
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', CC: 'canton-network',
  USDC: 'usd-coin', USDT: 'tether', TRX: 'tron', TON: 'the-open-network',
};

function extractAssetSymbol(description: string): string | null {
  const parts = description.trim().split(/\s+/);
  const symbol = parts[parts.length - 1];
  return symbol && COINGECKO_IDS[symbol] ? symbol : null;
}

function calculatePnL(
  direction: string | null, entryPrice: number, units: number, currentPrice: number,
): number {
  if (!entryPrice || !units || !currentPrice) return 0;
  return direction === 'Short'
    ? units * (entryPrice - currentPrice)
    : units * (currentPrice - entryPrice);
}

function resolveSymbol(assetId: string, assetType: string): string {
  if (assetId) {
    const parts = assetId.split('-');
    const symbolParts: string[] = [];
    for (const part of parts) {
      if (/^\d{10,}$/.test(part)) break;
      symbolParts.push(part);
    }
    if (symbolParts.length > 0) {
      const sym = symbolParts.join('-');
      if (FALLBACK_PRICES[sym] !== undefined) return sym;
    }
  }
  switch (assetType) {
    case 'Stablecoin': return 'USDC';
    case 'CantonCoin': return 'CC';
    case 'Cryptocurrency': return 'ETH';
    default: return assetType;
  }
}

function calculateVaultValue(
  vaultId: string, assets: VaultAsset[], prices: Record<string, number>,
): number {
  let total = 0;
  for (const asset of assets) {
    const amount = parseFloat(asset.amount) || 0;
    const symbol = resolveSymbol(asset.assetId, asset.assetType);
    const price = prices[symbol] || 1;
    total += amount * price;
    console.log(`[LTV Monitor] Vault ${vaultId} asset: id=${asset.assetId} type=${asset.assetType} → symbol=${symbol} amount=${amount} price=${price} subtotal=${amount * price}`);
  }
  if (assets.length === 0) {
    console.warn(`[LTV Monitor] Vault ${vaultId}: collateralAssets is EMPTY`);
  }
  console.log(`[LTV Monitor] Vault ${vaultId} total value: $${total.toFixed(4)}`);
  return total;
}

// Helper: query active contract for a positionId
async function queryActivePosition(
  sdk: ReturnType<typeof getSDK>,
  positionId: string,
): Promise<{ contractId: string; payload: PositionPayload } | null> {
  const results = await sdk.cantonQuery({
    templateId: TEMPLATE_IDS.POSITION, filter: { positionId },
  }) as unknown as Array<{ contractId: string; payload: PositionPayload }>;
  return results.find(c =>
    c.payload.status === 'Open' || c.payload.status === 'MarginCalled',
  ) || null;
}

// Guard against overlapping runs
let cycleRunning = false;

/**
 * Run one full LTV check cycle using the Stratos SDK.
 * Returns a WorkflowRunRecord for dashboard display.
 */
export async function runLTVCheckCycle(): Promise<WorkflowRunRecord> {
  if (cycleRunning) {
    throw new Error('LTV check cycle already running');
  }
  cycleRunning = true;
  const errors: string[] = [];

  try {
    const sdk = getSDK({ timeout: 120000 });
    const operatorParty = await getOperatorParty();
    if (!operatorParty) throw new Error('Operator party not configured');

    // Step 1: Fetch all open + margin-called positions
    const [openPositions, mcPositions] = await Promise.all([
      sdk.cantonQuery({ templateId: TEMPLATE_IDS.POSITION, filter: { status: 'Open' } }),
      sdk.cantonQuery({ templateId: TEMPLATE_IDS.POSITION, filter: { status: 'MarginCalled' } }),
    ]);
    const positions = [...openPositions, ...mcPositions] as unknown as Array<{ contractId: string; payload: PositionPayload }>;

    if (positions.length === 0) {
      return {
        timestamp: new Date().toISOString(),
        processed: 0, marginCallsCreated: 0, errors, positions: [],
        prices: { CC: 0, ETH: 0, BTC: 0, USDC: 0, SOL: 0 },
      };
    }

    // Step 2: Fetch vaults for unique vaultIds (operator is vault observer)
    const uniqueVaultIds = [...new Set(positions.map(p => p.payload.vaultId))];
    const vaultMap: Record<string, { contractId: string; payload: VaultPayload }> = {};
    await Promise.all(uniqueVaultIds.map(async (vaultId) => {
      try {
        const results = await sdk.cantonQuery({
          templateId: TEMPLATE_IDS.VAULT, filter: { vaultId },
        }) as unknown as Array<{ contractId: string; payload: VaultPayload }>;
        if (results.length > 0) {
          vaultMap[vaultId] = results[0];
        } else {
          errors.push(`Vault ${vaultId}: not visible to operator`);
          console.warn(`[LTV Monitor] Vault ${vaultId} query returned 0 results`);
        }
      } catch (err: any) {
        errors.push(`Vault ${vaultId}: query failed — ${err?.message || err}`);
        console.error(`[LTV Monitor] Vault ${vaultId} query failed:`, err);
      }
    }));

    // Step 3: Live prices
    const prices = await fetchLivePrices();

    // Step 4: BrokerFundLink thresholds + leverage
    const brokerFundPairs = [...new Set(positions.map(p => `${p.payload.broker}|${p.payload.fund}`))];
    const thresholds: Record<string, number> = {};
    const leverages: Record<string, number> = {};

    await Promise.all(brokerFundPairs.map(async (pair) => {
      const [broker, fund] = pair.split('|');
      const results = await sdk.cantonQuery({
        templateId: TEMPLATE_IDS.BROKER_FUND_LINK, filter: { broker, fund },
      }) as Array<{ contractId: string; payload: LinkPayload }>;
      if (results.length > 0) {
        const link = results[0].payload;
        thresholds[pair] = parseFloat(link.ltvThreshold) || 0.8;
        leverages[pair] = link.leverageRatio != null ? (parseFloat(link.leverageRatio) || 1) : 1;
      } else {
        thresholds[pair] = 0.8;
        leverages[pair] = 1;
      }
    }));

    // Step 5: Compute PnL and per-vault aggregate LTV
    const positionPnLs: Record<string, number> = {};
    for (const pos of positions) {
      const entryPrice = parseFloat(pos.payload.entryPrice || '0') || 0;
      const units = parseFloat(pos.payload.units || '0') || 0;
      const assetSymbol = extractAssetSymbol(pos.payload.description);
      const currentPrice = assetSymbol ? (prices[assetSymbol] || 0) : 0;
      positionPnLs[pos.contractId] = calculatePnL(pos.payload.direction, entryPrice, units, currentPrice);
    }

    const vaultAggregates: Record<string, { totalNotional: number; totalPnL: number }> = {};
    for (const pos of positions) {
      const vid = pos.payload.vaultId;
      if (!vaultAggregates[vid]) vaultAggregates[vid] = { totalNotional: 0, totalPnL: 0 };
      vaultAggregates[vid].totalNotional += parseFloat(pos.payload.notionalValue) || 0;
      vaultAggregates[vid].totalPnL += positionPnLs[pos.contractId] || 0;
    }

    const ltvResults: LTVResult[] = positions.map(pos => {
      const vault = vaultMap[pos.payload.vaultId];
      const notional = parseFloat(pos.payload.notionalValue) || 0;
      const collateralValue = vault ? calculateVaultValue(pos.payload.vaultId, vault.payload.collateralAssets, prices) : 0;
      const pnl = positionPnLs[pos.contractId] || 0;
      const agg = vaultAggregates[pos.payload.vaultId];
      const effectiveCollateral = collateralValue + (agg?.totalPnL || 0);
      const totalNotional = agg?.totalNotional || notional;
      const pairKey = `${pos.payload.broker}|${pos.payload.fund}`;
      const leverageRatio = leverages[pairKey] || 1;
      const ltv = effectiveCollateral > 0
        ? totalNotional / (effectiveCollateral * leverageRatio)
        : (totalNotional > 0 ? 999 : 0);

      console.log(`[LTV Monitor] ${pos.payload.positionId}: collateral=$${collateralValue.toFixed(4)} pnl=$${pnl.toFixed(4)} effective=$${effectiveCollateral.toFixed(4)} notional=$${totalNotional.toFixed(4)} leverage=${leverageRatio} → LTV=${(ltv * 100).toFixed(1)}%`);

      return {
        contractId: pos.contractId,
        positionId: pos.payload.positionId,
        vaultId: pos.payload.vaultId,
        fund: pos.payload.fund,
        broker: pos.payload.broker,
        operator: pos.payload.operator,
        status: pos.payload.status,
        notional, collateralValue, pnl,
        currentLTV: ltv === Infinity ? 999 : ltv,
      };
    });

    // Step 6: Per-position exercises — margin call, UpdateLTV, attestation
    // Each exercise archives the old contract and returns a new contractId.
    // We chain exercises sequentially per position to avoid stale-contract races.
    let marginCallsCreated = 0;

    // Pre-compute attestation hashes per vault and store to KV so broker can verify
    const vaultProofHashes: Record<string, string> = {};
    const attestedAt = new Date().toISOString();
    for (const vaultId of uniqueVaultIds) {
      const vault = vaultMap[vaultId];
      if (!vault) continue;
      const vaultResult = ltvResults.find(r => r.vaultId === vaultId);
      if (!vaultResult) continue;
      const attestPayload = {
        type: 'operator-attestation' as const,
        vaultId,
        collateral: vaultResult.collateralValue,
        notional: vaultResult.notional,
        currentLTV: vaultResult.currentLTV,
        attestedAt,
      };
      const attestData = JSON.stringify(attestPayload);
      const hashBuffer = await crypto.subtle.digest(
        'SHA-256', new TextEncoder().encode(attestData),
      );
      const hash = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      vaultProofHashes[vaultId] = hash;

      // Store to KV so broker can fetch and verify
      try {
        const kvRes = await fetch('/api/zkproof', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hash, proof: attestPayload }),
        });
        if (!kvRes.ok) {
          console.warn(`[LTV Monitor] KV store failed for vault ${vaultId}: ${kvRes.status}`);
        } else {
          console.log(`[LTV Monitor] KV stored attestation: vault=${vaultId} hash=${hash.slice(0, 16)}...`);
        }
      } catch (kvErr: any) {
        console.warn(`[LTV Monitor] KV store error for vault ${vaultId}:`, kvErr?.message || kvErr);
      }
    }

    for (const result of ltvResults) {
      const pairKey = `${result.broker}|${result.fund}`;
      const threshold = thresholds[pairKey] || 0.8;
      const isBreached = result.currentLTV >= threshold;
      const needsMarginCall = isBreached && result.status !== 'MarginCalled';

      // Retry wrapper for locked-contract contention (Canton 409)
      const MAX_RETRIES = 3;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // Re-query to get fresh contract ID (handles both first attempt and retries)
          const active = await queryActivePosition(sdk, result.positionId);
          if (!active) {
            errors.push(`${result.positionId}: no active contract found`);
            break;
          }
          let currentCid = active.contractId;

          // 6a: Create margin call if newly breached
          if (needsMarginCall && attempt === 1) {
            const leverageRatio = leverages[pairKey] || 1;
            const requiredAmount = result.notional - (result.collateralValue * leverageRatio * threshold);

            await sdk.cantonCreate({
              templateId: TEMPLATE_IDS.WORKFLOW_MARGIN_CALL,
              payload: {
                operator: result.operator,
                fund: result.fund,
                broker: result.broker,
                positionId: result.positionId,
                vaultId: result.vaultId,
                requiredAmount: toDecimal10(requiredAmount),
                currentLTV: toDecimal10(result.currentLTV),
                ltvThreshold: toDecimal10(threshold),
                callTime: new Date().toISOString(),
                status: 'WMCActive',
              },
            });

            // MarkMarginCalled — use the current CID, capture new CID
            const mcResult = await sdk.cantonExercise({
              contractId: currentCid,
              templateId: TEMPLATE_IDS.POSITION,
              choice: CHOICES.MARK_MARGIN_CALLED,
              argument: {},
            });
            if (mcResult?.exerciseResult) {
              currentCid = mcResult.exerciseResult as unknown as string;
            } else {
              const fresh = await queryActivePosition(sdk, result.positionId);
              if (fresh) currentCid = fresh.contractId;
            }
            marginCallsCreated++;
            console.log(`[LTV Monitor] Margin call: ${result.positionId} LTV ${(result.currentLTV * 100).toFixed(1)}%`);
          }

          // 6b: UpdateLTV — chain from currentCid
          const updateResult = await sdk.cantonExercise({
            contractId: currentCid,
            templateId: TEMPLATE_IDS.POSITION,
            choice: CHOICES.UPDATE_LTV,
            argument: {
              newLTV: toDecimal10(result.currentLTV),
              checkedAt: new Date().toISOString(),
              newPnL: toDecimal10(result.pnl),
            },
          });
          if (updateResult?.exerciseResult) {
            currentCid = updateResult.exerciseResult as unknown as string;
          } else {
            const fresh = await queryActivePosition(sdk, result.positionId);
            if (fresh) currentCid = fresh.contractId;
          }

          // 6c: OperatorAttestCollateral — chain from currentCid
          // Attestation data is stored to KV above so broker can verify
          const proofHash = vaultProofHashes[result.vaultId];
          if (proofHash) {
            await sdk.cantonExercise({
              contractId: currentCid,
              templateId: TEMPLATE_IDS.POSITION,
              choice: CHOICES.OPERATOR_ATTEST_COLLATERAL,
              argument: { proofHash, attestedAt },
            });
            console.log(`[LTV Monitor] Attested ${result.positionId}: hash=${proofHash.slice(0, 16)}...`);
          } else {
            console.warn(`[LTV Monitor] No attestation hash for ${result.positionId} (vault ${result.vaultId} not in vaultMap)`);
          }

          break; // Success — exit retry loop
        } catch (err: any) {
          const msg = err?.message || String(err);
          const isContention = msg.includes('LOCKED_CONTRACTS') || msg.includes('409');
          if (isContention && attempt < MAX_RETRIES) {
            console.warn(`[LTV Monitor] ${result.positionId}: contract locked, retry ${attempt}/${MAX_RETRIES} in 1.5s`);
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          errors.push(`${result.positionId}: ${msg}`);
          console.error(`[LTV Monitor] Exercise failed:`, `${result.positionId}: ${msg}`);
          break;
        }
      }
    }

    // Build run record
    const record: WorkflowRunRecord = {
      timestamp: new Date().toISOString(),
      processed: positions.length,
      marginCallsCreated,
      errors,
      positions: ltvResults.map(r => {
        const pairKey = `${r.broker}|${r.fund}`;
        const threshold = thresholds[pairKey] || 0.8;
        return {
          positionId: r.positionId,
          vaultId: r.vaultId,
          fund: r.fund,
          broker: r.broker,
          notional: r.notional,
          collateralValue: r.collateralValue,
          pnl: r.pnl,
          currentLTV: r.currentLTV,
          breached: r.currentLTV >= threshold,
          autoLiquidated: false,
        };
      }),
      prices: {
        CC: prices['CC'] || 0,
        ETH: prices['ETH'] || 0,
        BTC: prices['BTC'] || 0,
        USDC: prices['USDC'] || 0,
        SOL: prices['SOL'] || 0,
      },
    };

    if (errors.length > 0) {
      console.warn(`[LTV Monitor] ${errors.length} error(s):`, errors);
    }
    console.log(`[LTV Monitor] Complete: ${positions.length} positions, ${marginCallsCreated} margin calls`);
    return record;
  } finally {
    cycleRunning = false;
  }
}
