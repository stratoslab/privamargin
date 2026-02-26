/**
 * PrivaMargin LTV Monitor Workflow
 *
 * Cloudflare Workflow that runs on a configurable interval (default 15 min) to:
 *
 * 1. Fetch all open/margin-called Position contracts from Canton
 * 2. Fetch CollateralVault values and reprice with live market data (CoinGecko)
 * 3. Compute per-position PnL and aggregate LTV per vault (leverage-aware)
 * 4. Check LTV against BrokerFundLink thresholds; create WorkflowMarginCall
 *    and optionally auto-liquidate (EVM seizure + Canton LiquidatePosition)
 * 5. Update on-ledger LTV via UpdateLTV for all surviving positions
 * 6. Generate SHA-256 collateral attestation per vault and exercise
 *    OperatorAttestCollateral (controller operator) on all positions
 * 7. Persist run record to KV for operator dashboard visibility
 *
 * ZK Proofs (dual-layer):
 *   - Operator attestation: This workflow generates a SHA-256 hash of the
 *     vault's collateral state each cycle and writes it on-ledger via
 *     OperatorAttestCollateral. This ensures every position always has a
 *     fresh attestation (purple shield).
 *   - Fund Groth16 proof: When the fund loads the Positions page, their
 *     browser can upgrade the attestation to a real Groth16 ZK proof via
 *     snarkjs (see src/services/zkProof.ts) and AttestCollateral
 *     (controller fund). This provides cryptographic privacy guarantees.
 *
 * Environment Variables:
 *   CANTON_HOST           — Canton JSON API v1 host (e.g. p2-json.cantondefi.com)
 *   CANTON_AUTH_TOKEN      — Bearer token for Canton JSON API
 *   OPERATOR_PARTY         — Canton party ID of the operator
 *   PACKAGE_ID             — Daml package ID for template resolution
 *   PRIVAMARGIN_CONFIG     — KV namespace for config, run records, ZK proofs
 *
 * Secrets (set via `wrangler secret put`):
 *   CANTON_AUTH_TOKEN, OPERATOR_PARTY, DEPLOYER_PRIVATE_KEY, CANTON_AUTH_SECRET
 */

import {
  WorkflowEntrypoint,
  WorkflowStep,
  WorkflowEvent,
} from 'cloudflare:workers';

import { executeLiquidation, type LiquidationEnv } from './liquidation';

interface Env extends LiquidationEnv {
  CANTON_HOST: string;
  CANTON_AUTH_TOKEN: string;
  OPERATOR_PARTY: string;
  PACKAGE_ID: string;
  COINMARKETCAP_API_KEY?: string; // deprecated — now uses CoinGecko
  USDC_TEMPLATE_ID?: string;
  SPLICE_ADMIN_USER?: string;
  PRIVAMARGIN_CONFIG: KVNamespace;
  LTV_MONITOR_WORKFLOW: Workflow;
}

interface PositionContract {
  contractId: string;
  payload: {
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
  };
}

interface VaultContract {
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
}

interface LinkContract {
  contractId: string;
  payload: {
    broker: string;
    fund: string;
    operator: string;
    linkId: string;
    ltvThreshold: string;
    leverageRatio: string | null;
    isActive: boolean;
    linkedAt: string;
  };
}

// Generate a JWT for Canton JSON API (same approach as cloudflare-wallet)
async function generateCantonToken(env: Env): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: env.SPLICE_ADMIN_USER || 'app-user',
    aud: env.CANTON_AUTH_AUDIENCE || 'https://canton.network.global',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const encoder = new TextEncoder();
  const b64url = (data: Uint8Array) => btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const headerB64 = b64url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = b64url(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(env.CANTON_AUTH_SECRET || 'unsafe'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput))
  );
  return `${signingInput}.${b64url(signature)}`;
}

async function getCantonToken(env: Env): Promise<string> {
  // Always self-generate JWT to match the current CANTON_HOST.
  // Pre-set CANTON_AUTH_TOKEN may be stale or bound to a different host.
  return generateCantonToken(env);
}

// Canton JSON API helpers
async function cantonQuery(env: Env, templateId: string, filter?: Record<string, unknown>): Promise<any[]> {
  const body: any = {
    templateIds: [templateId],
  };
  if (filter) {
    body.query = filter;
  }

  const token = await getCantonToken(env);
  const response = await fetch(`https://${env.CANTON_HOST}/v1/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canton query failed: ${response.status} ${text}`);
  }

  const data = await response.json() as { result: any[] };
  return data.result || [];
}

async function cantonCreate(env: Env, templateId: string, payload: Record<string, unknown>): Promise<any> {
  const token = await getCantonToken(env);
  const response = await fetch(`https://${env.CANTON_HOST}/v1/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      templateId,
      payload,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canton create failed: ${response.status} ${text}`);
  }

  return await response.json();
}

async function cantonExercise(env: Env, contractId: string, templateId: string, choice: string, argument: Record<string, unknown>): Promise<any> {
  const token = await getCantonToken(env);
  const response = await fetch(`https://${env.CANTON_HOST}/v1/exercise`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      templateId,
      contractId,
      choice,
      argument,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Canton exercise failed: ${response.status} ${text}`);
  }

  return await response.json();
}

// CoinGecko ID mapping (matches frontend api.ts)
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  CC: 'canton-network',
  USDC: 'usd-coin',
  USDT: 'tether',
  TRX: 'tron',
  TON: 'the-open-network',
};

const FALLBACK_PRICES: Record<string, number> = {
  CC: 0.50, CUSD: 1.0, USDC: 1.0, USDT: 1.0,
  BTC: 95000, ETH: 3500, SOL: 180, TRX: 0.25, TON: 5.50,
};

// Map Daml AssetType enum to symbol for pricing
function assetTypeToSymbol(assetType: string): string {
  switch (assetType) {
    case 'CantonCoin': return 'CC';
    case 'Cryptocurrency': return 'BTC'; // default; vault tracks by assetId
    case 'Stablecoin': return 'USDC';
    case 'Equity': return 'CC';
    default: return 'USDC';
  }
}

// Extract the traded asset symbol from the position description
// Format: "LONG 10 ETH" or "SHORT 5 BTC" → "ETH" or "BTC"
function extractAssetSymbol(description: string): string | null {
  const parts = description.trim().split(/\s+/);
  // Last word is typically the symbol
  const symbol = parts[parts.length - 1];
  return symbol && COINGECKO_IDS[symbol] ? symbol : null;
}

// Calculate unrealized PnL for a position given current price
function calculatePnL(
  direction: string | null,
  entryPrice: number,
  units: number,
  currentPrice: number,
): number {
  if (!entryPrice || !units || !currentPrice) return 0;
  if (direction === 'Short') {
    return units * (entryPrice - currentPrice);
  }
  // Default to Long
  return units * (currentPrice - entryPrice);
}

async function fetchLivePrices(): Promise<Record<string, number>> {
  const prices = { ...FALLBACK_PRICES };

  try {
    const ids = Object.values(COINGECKO_IDS).join(',');
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
    );

    if (response.ok) {
      const data = await response.json() as Record<string, { usd?: number }>;

      for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
        if (data[geckoId]?.usd) {
          prices[symbol] = data[geckoId].usd;
        }
      }
    }
  } catch (err) {
    console.error('Failed to fetch CoinGecko prices:', err);
  }

  return prices;
}

// Recalculate vault value using live prices
function calculateVaultValue(
  vault: VaultContract,
  prices: Record<string, number>
): number {
  let total = 0;
  for (const asset of vault.payload.collateralAssets) {
    const amount = parseFloat(asset.amount) || 0;
    // Try to extract symbol from assetId (e.g., "BTC-1234" -> "BTC")
    const symbolFromId = asset.assetId.split('-')[0];
    const symbol = symbolFromId && prices[symbolFromId]
      ? symbolFromId
      : assetTypeToSymbol(asset.assetType);
    const price = prices[symbol] || 1;
    total += amount * price;
  }
  return total;
}

// ============================================
// WORKFLOW DEFINITION
// ============================================

export class LTVMonitorWorkflow extends WorkflowEntrypoint<Env, {}> {
  async run(event: WorkflowEvent<{}>, step: WorkflowStep) {
    const env = this.env;
    const pkgId = env.PACKAGE_ID;

    const POSITION_TEMPLATE = `${pkgId}:Position:Position`;
    const VAULT_TEMPLATE = `${pkgId}:CollateralVault:CollateralVault`;
    const LINK_TEMPLATE = `${pkgId}:BrokerFundLink:BrokerFundLink`;
    const WORKFLOW_MC_TEMPLATE = `${pkgId}:MarginVerification:WorkflowMarginCall`;

    // Step 1: Fetch all open and margin-called positions
    const positions = await step.do('fetch-positions', async () => {
      const [openResults, mcResults] = await Promise.all([
        cantonQuery(env, POSITION_TEMPLATE, { status: 'Open' }),
        cantonQuery(env, POSITION_TEMPLATE, { status: 'MarginCalled' }),
      ]);
      const results = [...openResults, ...mcResults];
      console.log(`Found ${results.length} positions (${openResults.length} open, ${mcResults.length} margin-called)`);
      return results as PositionContract[];
    });

    if (positions.length === 0) {
      console.log('No open positions to monitor');

      // Still persist a run record so operator dashboard shows activity
      const emptyTimestamp = new Date().toISOString();
      await step.do('persist-empty-run-record', async () => {
        const runRecord = {
          timestamp: emptyTimestamp,
          processed: 0,
          marginCallsCreated: 0,
          positions: [],
          prices: {},
        };
        await env.PRIVAMARGIN_CONFIG.put(
          `workflow:run:${emptyTimestamp}`,
          JSON.stringify(runRecord),
          { expirationTtl: 30 * 24 * 60 * 60 }
        );
        const indexRaw = await env.PRIVAMARGIN_CONFIG.get('workflow:runs:index');
        const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
        index.push(emptyTimestamp);
        if (index.length > 20) index.splice(0, index.length - 20);
        await env.PRIVAMARGIN_CONFIG.put('workflow:runs:index', JSON.stringify(index));
        console.log(`Persisted empty run record: ${emptyTimestamp}`);
      });

      return { processed: 0, marginCallsCreated: 0 };
    }

    // Step 2: Fetch vault values for unique vaults
    const uniqueVaultIds = [...new Set(positions.map(p => p.payload.vaultId))];

    const vaults = await step.do('fetch-vault-values', async () => {
      const vaultMap: Record<string, VaultContract> = {};
      for (const vaultId of uniqueVaultIds) {
        const results = await cantonQuery(env, VAULT_TEMPLATE, { vaultId });
        if (results.length > 0) {
          vaultMap[vaultId] = results[0] as VaultContract;
        }
      }
      console.log(`Fetched ${Object.keys(vaultMap).length} vaults`);
      return vaultMap;
    });

    // Step 3: Fetch live prices
    const prices = await step.do('fetch-live-prices', async () => {
      return await fetchLivePrices();
    });

    // Step 4: Fetch LTV thresholds and leverage ratios from BrokerFundLink
    const brokerFundPairs = [...new Set(positions.map(p => `${p.payload.broker}|${p.payload.fund}`))];

    const linkData = await step.do('fetch-thresholds', async () => {
      const thresholdMap: Record<string, number> = {};
      const leverageMap: Record<string, number> = {};
      for (const pair of brokerFundPairs) {
        const [broker, fund] = pair.split('|');
        const results = await cantonQuery(env, LINK_TEMPLATE, { broker, fund });
        if (results.length > 0) {
          const link = results[0] as LinkContract;
          thresholdMap[pair] = parseFloat(link.payload.ltvThreshold) || 0.8;
          leverageMap[pair] = link.payload.leverageRatio != null ? (parseFloat(link.payload.leverageRatio) || 1) : 1;
        } else {
          thresholdMap[pair] = 0.8;
          leverageMap[pair] = 1;
        }
      }
      return { thresholdMap, leverageMap };
    });

    const thresholds = linkData.thresholdMap;
    const leverages = linkData.leverageMap;

    // Step 5: Compute PnL and LTVs (leverage-aware)
    //   PnL: Long = units * (currentPrice - entryPrice), Short = reverse
    //   LTV: totalNotional / (effectiveCollateral * leverageRatio)
    //   Multiple positions on one vault share the collateral, so we aggregate.
    const ltvResults = await step.do('compute-ltvs', async () => {
      // Pre-compute per-position PnL
      const positionPnLs: Record<string, number> = {};
      for (const pos of positions) {
        const entryPrice = parseFloat(pos.payload.entryPrice || '0') || 0;
        const units = parseFloat(pos.payload.units || '0') || 0;
        const assetSymbol = extractAssetSymbol(pos.payload.description);
        const currentPrice = assetSymbol ? (prices[assetSymbol] || 0) : 0;
        positionPnLs[pos.contractId] = calculatePnL(pos.payload.direction, entryPrice, units, currentPrice);
      }

      // Aggregate notional + PnL per vault (only open/margin-called positions)
      const vaultAggregates: Record<string, { totalNotional: number; totalPnL: number }> = {};
      for (const pos of positions) {
        const vid = pos.payload.vaultId;
        if (!vaultAggregates[vid]) vaultAggregates[vid] = { totalNotional: 0, totalPnL: 0 };
        vaultAggregates[vid].totalNotional += parseFloat(pos.payload.notionalValue) || 0;
        vaultAggregates[vid].totalPnL += positionPnLs[pos.contractId] || 0;
      }

      return positions.map(pos => {
        const vault = vaults[pos.payload.vaultId];
        const notional = parseFloat(pos.payload.notionalValue) || 0;
        let collateralValue = 0;
        if (vault) {
          collateralValue = calculateVaultValue(vault, prices);
        }

        const pnl = positionPnLs[pos.contractId] || 0;
        const agg = vaultAggregates[pos.payload.vaultId];

        // Effective collateral = vault collateral + aggregate PnL of all positions on this vault
        const effectiveCollateral = collateralValue + (agg?.totalPnL || 0);
        // LTV = aggregate notional / (effective collateral * leverage)
        const totalNotional = agg?.totalNotional || notional;
        const pairKey = `${pos.payload.broker}|${pos.payload.fund}`;
        const leverageRatio = leverages[pairKey] || 1;
        const ltv = effectiveCollateral > 0 ? totalNotional / (effectiveCollateral * leverageRatio) : (totalNotional > 0 ? Infinity : 0);

        return {
          contractId: pos.contractId,
          positionId: pos.payload.positionId,
          vaultId: pos.payload.vaultId,
          fund: pos.payload.fund,
          broker: pos.payload.broker,
          operator: pos.payload.operator,
          status: pos.payload.status,
          notional,
          collateralValue,
          pnl,
          currentLTV: ltv === Infinity ? 999 : ltv,
        };
      });
    });

    // Step 5b: Fetch auto-liquidate preferences from KV
    const autoLiqFlags = await step.do('fetch-auto-liquidate-prefs', async () => {
      const flagMap: Record<string, boolean> = {};
      for (const pair of brokerFundPairs) {
        const [broker, fund] = pair.split('|');
        const value = await env.PRIVAMARGIN_CONFIG.get(`auto_liquidate:${broker}|${fund}`);
        flagMap[pair] = value === 'true';
      }
      return flagMap;
    });

    // Step 5c: Fetch custodian party from KV (for Canton USDC transfers during liquidation)
    const custodianParty = await step.do('fetch-custodian-party', async () => {
      return await env.PRIVAMARGIN_CONFIG.get('custodianParty') || '';
    });

    // Step 6: Create margin calls for breaches
    let marginCallsCreated = 0;
    const liquidatedPositionIds = new Set<string>();

    for (const result of ltvResults) {
      const pairKey = `${result.broker}|${result.fund}`;
      const threshold = thresholds[pairKey] || 0.8;

      if (result.currentLTV >= threshold) {
        try {
          await step.do(`margin-call-${result.positionId}`, async () => {
            const leverageRatio = leverages[pairKey] || 1;
            const requiredAmount = result.notional - (result.collateralValue * leverageRatio * threshold);
            let currentContractId = result.contractId;
            const alreadyMarginCalled = result.status === 'MarginCalled';

            if (!alreadyMarginCalled) {
              // Create WorkflowMarginCall
              await cantonCreate(env, WORKFLOW_MC_TEMPLATE, {
                operator: env.OPERATOR_PARTY,
                fund: result.fund,
                broker: result.broker,
                positionId: result.positionId,
                vaultId: result.vaultId,
                requiredAmount: requiredAmount.toString(),
                currentLTV: result.currentLTV.toString(),
                ltvThreshold: threshold.toString(),
                callTime: new Date().toISOString(),
                status: 'WMCActive',
              });

              // Mark position as margin called
              const mcResult = await cantonExercise(
                env,
                result.contractId,
                POSITION_TEMPLATE,
                'MarkMarginCalled',
                {}
              );
              // MarkMarginCalled archives old contract — use new contract ID
              if (mcResult?.result?.exerciseResult) {
                currentContractId = mcResult.result.exerciseResult;
              }
            }

            // Auto-liquidate if enabled for this broker-fund pair (from KV)
            if (autoLiqFlags[pairKey]) {
              const vault = vaults[result.vaultId];
              let liquidatedAmount = requiredAmount;
              let seizedVaultAssets: Array<{ assetId: string; amount: number }> = [];

              if (vault && env.DEPLOYER_PRIVATE_KEY && env.CANTON_AUTH_SECRET) {
                try {
                  const liqResult = await executeLiquidation({
                    env,
                    position: {
                      contractId: currentContractId,
                      positionId: result.positionId,
                      vaultId: result.vaultId,
                      fund: result.fund,
                      broker: result.broker,
                      notional: result.notional,
                      collateralValue: result.collateralValue,
                      pnl: result.pnl,
                      currentLTV: result.currentLTV,
                    },
                    vault,
                    prices,
                    threshold,
                    custodianParty,
                  });

                  if (liqResult.totalSeizedUSD > 0) {
                    liquidatedAmount = liqResult.totalSeizedUSD;
                  }

                  seizedVaultAssets = liqResult.seizedVaultAssets;

                  console.log(`[Auto-Liquidation] Position ${result.positionId}: seized $${liqResult.totalSeizedUSD.toFixed(2)}, ` +
                    `escrow: ${liqResult.escrowSeizures.length}, canton: ${liqResult.cantonSeizures.length}, errors: ${liqResult.errors.length}`);

                  if (liqResult.errors.length > 0) {
                    console.warn(`[Auto-Liquidation] Errors for ${result.positionId}:`, liqResult.errors.join('; '));
                  }
                } catch (err) {
                  console.error(`[Auto-Liquidation] Seizure failed for ${result.positionId}, proceeding with LiquidatePosition:`, err);
                }
              } else {
                console.log(`[Auto-Liquidation] Skipping seizure for ${result.positionId}: missing DEPLOYER_PRIVATE_KEY or CANTON_AUTH_SECRET`);
              }

              // Exercise SeizeCollateral on the vault for each seized asset
              if (seizedVaultAssets.length > 0) {
                const freshVaults = await cantonQuery(env, VAULT_TEMPLATE, { vaultId: result.vaultId });
                let vaultCid = freshVaults[0]?.contractId;
                if (vaultCid) {
                  for (const seized of seizedVaultAssets) {
                    try {
                      const seizeResult = await cantonExercise(env, vaultCid, VAULT_TEMPLATE, 'SeizeCollateral', {
                        assetId: seized.assetId,
                        seizeAmount: seized.amount.toString(),
                        reason: `Auto-liquidation of position ${result.positionId}`,
                      });
                      // SeizeCollateral archives old contract — use new contractId
                      if (seizeResult?.result?.exerciseResult) {
                        vaultCid = seizeResult.result.exerciseResult;
                      }
                    } catch (err) {
                      console.error(`[Auto-Liquidation] SeizeCollateral failed for ${seized.assetId}:`, err);
                    }
                  }
                }
              }

              // Resolve closing price for this position's asset
              const posDesc = positions.find(p => p.contractId === result.contractId)?.payload.description || '';
              const assetSym = extractAssetSymbol(posDesc);
              const closingPrice = assetSym ? (prices[assetSym] || 0) : 0;

              // Always exercise LiquidatePosition on Canton (even if seizure partially failed)
              await cantonExercise(env, currentContractId, POSITION_TEMPLATE, 'LiquidatePosition', {
                ltvThreshold: threshold.toString(),
                liquidatedAmount: liquidatedAmount.toString(),
                liquidatedAt: new Date().toISOString(),
                finalPnL: result.pnl.toString(),
                exitPrice: closingPrice > 0 ? closingPrice.toString() : null,
              });
              liquidatedPositionIds.add(result.positionId);
              console.log(`Auto-liquidated position ${result.positionId}: LTV ${(result.currentLTV * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(0)}%, amount: $${liquidatedAmount.toFixed(2)}`);
            }

            console.log(`Created margin call for ${result.positionId}: LTV ${(result.currentLTV * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(0)}%`);
          });
          marginCallsCreated++;
        } catch (err) {
          console.error(`Failed to create margin call for ${result.positionId}:`, err);
        }
      }
    }

    // Step 7: Update LTVs for all positions that weren't liquidated in this run.
    // Positions that were margin-called (new or existing) still need their on-ledger LTV refreshed.
    // Note: MarkMarginCalled archives the old contract, so for newly margin-called positions
    // we must re-query to get the current contract ID.
    for (const result of ltvResults) {
      if (liquidatedPositionIds.has(result.positionId)) continue;
      try {
        await step.do(`update-ltv-${result.positionId}`, async () => {
          // Re-query to get the current contract ID (may have changed due to MarkMarginCalled)
          const current = await cantonQuery(env, POSITION_TEMPLATE, { positionId: result.positionId });
          const activeContract = current.find((c: PositionContract) =>
            c.payload.status === 'Open' || c.payload.status === 'MarginCalled'
          );
          if (!activeContract) return;

          await cantonExercise(
            env,
            activeContract.contractId,
            POSITION_TEMPLATE,
            'UpdateLTV',
            {
              newLTV: result.currentLTV.toString(),
              checkedAt: new Date().toISOString(),
              newPnL: result.pnl.toString(),
            }
          );
        });
      } catch (err) {
        console.error(`Failed to update LTV for ${result.positionId}:`, err);
      }
    }

    // Step 7b: Operator SHA-256 collateral attestation per vault.
    // For each vault, hash the collateral state and exercise OperatorAttestCollateral
    // on all positions sharing that vault. This gives every position a ZK proof shield.
    const attestedVaults = new Set<string>();
    for (const result of ltvResults) {
      if (liquidatedPositionIds.has(result.positionId)) continue;
      if (attestedVaults.has(result.vaultId)) continue;
      attestedVaults.add(result.vaultId);

      const vault = vaults[result.vaultId];
      if (!vault) continue;

      try {
        await step.do(`attest-vault-${result.vaultId}`, async () => {
          // Hash the vault's collateral state
          const attestData = JSON.stringify({
            vaultId: result.vaultId,
            collateralAssets: vault.payload.collateralAssets,
            collateralValue: result.collateralValue,
            timestamp: Date.now(),
          });
          const hashBuffer = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(attestData),
          );
          const proofHash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
          const attestedAt = new Date().toISOString();

          // Store proof to KV for UI retrieval
          await env.PRIVAMARGIN_CONFIG.put(`zkproof:${proofHash}`, JSON.stringify({
            type: 'sha256-operator',
            vaultId: result.vaultId,
            collateralValue: result.collateralValue,
            attestedAt,
          }), { expirationTtl: 86400 }); // 24h TTL

          // Exercise OperatorAttestCollateral on all positions for this vault
          const vaultPositions = ltvResults.filter(r =>
            r.vaultId === result.vaultId && !liquidatedPositionIds.has(r.positionId)
          );
          for (const vp of vaultPositions) {
            const current = await cantonQuery(env, POSITION_TEMPLATE, { positionId: vp.positionId });
            const active = current.find((c: PositionContract) =>
              c.payload.status === 'Open' || c.payload.status === 'MarginCalled'
            );
            if (!active) continue;
            try {
              await cantonExercise(
                env,
                active.contractId,
                POSITION_TEMPLATE,
                'OperatorAttestCollateral',
                { proofHash, attestedAt },
              );
              console.log(`[Attest] ${vp.positionId}: hash=${proofHash.slice(0, 16)}...`);
            } catch (err) {
              console.warn(`[Attest] Failed for ${vp.positionId}:`, err);
            }
          }
        });
      } catch (err) {
        console.error(`[Attest] Vault ${result.vaultId} attestation failed:`, err);
      }
    }

    const summary = {
      processed: positions.length,
      marginCallsCreated,
      timestamp: new Date().toISOString(),
    };

    // Step 8: Persist run record to KV for operator dashboard visibility
    await step.do('persist-run-record', async () => {
      const runRecord = {
        timestamp: summary.timestamp,
        processed: summary.processed,
        marginCallsCreated: summary.marginCallsCreated,
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
            autoLiquidated: r.currentLTV >= threshold && (autoLiqFlags[pairKey] || false),
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

      // Write the individual run record (30-day TTL)
      await env.PRIVAMARGIN_CONFIG.put(
        `workflow:run:${summary.timestamp}`,
        JSON.stringify(runRecord),
        { expirationTtl: 30 * 24 * 60 * 60 }
      );

      // Maintain rolling index of last 20 timestamps
      const indexRaw = await env.PRIVAMARGIN_CONFIG.get('workflow:runs:index');
      const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
      index.push(summary.timestamp);
      if (index.length > 100) {
        index.splice(0, index.length - 100);
      }
      await env.PRIVAMARGIN_CONFIG.put('workflow:runs:index', JSON.stringify(index));

      console.log(`Persisted run record: ${summary.timestamp}`);
    });

    console.log(`LTV Monitor complete: ${summary.processed} positions processed, ${summary.marginCallsCreated} margin calls created`);
    return summary;
  }
}

// ============================================
// SCHEDULED TRIGGER
// ============================================

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log('LTV Monitor scheduled check triggered');

    // KV-gated interval: only run if enough time has elapsed since last scheduled run
    const intervalRaw = await env.PRIVAMARGIN_CONFIG.get('workflow:check_interval');
    const intervalMinutes = intervalRaw ? parseInt(intervalRaw, 10) : 15;
    const lastScheduled = await env.PRIVAMARGIN_CONFIG.get('workflow:last_scheduled');
    if (lastScheduled) {
      const elapsed = Date.now() - parseInt(lastScheduled, 10);
      if (elapsed < intervalMinutes * 60 * 1000) {
        console.log(`Skipping: only ${Math.round(elapsed / 1000)}s since last scheduled (interval: ${intervalMinutes}m)`);
        return;
      }
    }

    // Write timestamp BEFORE creating workflow to prevent duplicates from the next cron tick
    await env.PRIVAMARGIN_CONFIG.put('workflow:last_scheduled', String(Date.now()));

    const instance = await env.LTV_MONITOR_WORKFLOW.create();
    console.log(`Started workflow instance: ${instance.id}`);
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === '/run') {
      const instance = await env.LTV_MONITOR_WORKFLOW.create();
      return Response.json({
        success: true,
        instanceId: instance.id,
        status: 'started',
      });
    }

    if (url.pathname === '/status') {
      const instanceId = url.searchParams.get('id');
      if (!instanceId) {
        return Response.json({ error: 'Missing instance id' }, { status: 400 });
      }
      const instance = await env.LTV_MONITOR_WORKFLOW.get(instanceId);
      const status = await instance.status();
      return Response.json({
        instanceId,
        status: status.status,
        output: status.output,
      });
    }

    return Response.json({
      name: 'privamargin-ltv-monitor',
      endpoints: {
        '/run': 'POST - Trigger LTV monitor workflow',
        '/status?id=XXX': 'GET - Check workflow status',
      },
    });
  },
};
