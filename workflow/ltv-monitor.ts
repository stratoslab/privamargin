/**
 * PrivaMargin LTV Monitor Workflow
 *
 * Cloudflare Workflow that runs every 15 minutes to:
 * 1. Fetch all open Position contracts
 * 2. Fetch vault values with live prices
 * 3. Recalculate LTVs
 * 4. Check against BrokerFundLink thresholds
 * 5. Create WorkflowMarginCall contracts for breaches
 * 6. Update Position LTVs on Canton
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
  COINMARKETCAP_API_KEY: string;
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
    isActive: boolean;
    linkedAt: string;
  };
}

// Canton JSON API helpers
async function cantonQuery(env: Env, templateId: string, filter?: Record<string, unknown>): Promise<any[]> {
  const body: any = {
    templateIds: [templateId],
  };
  if (filter) {
    body.query = filter;
  }

  const response = await fetch(`https://${env.CANTON_HOST}/v1/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.CANTON_AUTH_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Canton query failed: ${response.status} ${text}`);
    return [];
  }

  const data = await response.json() as { result: any[] };
  return data.result || [];
}

async function cantonCreate(env: Env, templateId: string, payload: Record<string, unknown>): Promise<any> {
  const response = await fetch(`https://${env.CANTON_HOST}/v1/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.CANTON_AUTH_TOKEN}`,
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
  const response = await fetch(`https://${env.CANTON_HOST}/v1/exercise`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.CANTON_AUTH_TOKEN}`,
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

// CoinMarketCap price fetching
const CMC_IDS: Record<string, number> = {
  CC: 37263,
  BTC: 1,
  ETH: 1027,
  SOL: 5426,
  USDC: 3408,
  USDT: 825,
  TRX: 1958,
  TON: 11419,
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
  return symbol && CMC_IDS[symbol] ? symbol : null;
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

async function fetchLivePrices(apiKey: string): Promise<Record<string, number>> {
  const prices = { ...FALLBACK_PRICES };

  if (!apiKey) return prices;

  try {
    const ids = Object.values(CMC_IDS).join(',');
    const response = await fetch(
      `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=${ids}`,
      {
        headers: {
          'X-CMC_PRO_API_KEY': apiKey,
          'Accept': 'application/json',
        },
      }
    );

    if (response.ok) {
      const data = await response.json() as {
        data?: Record<string, { quote?: { USD?: { price?: number } } }>
      };

      if (data.data) {
        for (const [symbol, cmcId] of Object.entries(CMC_IDS)) {
          const assetData = data.data[cmcId.toString()];
          if (assetData?.quote?.USD?.price) {
            prices[symbol] = assetData.quote.USD.price;
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to fetch CMC prices:', err);
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

    // Step 1: Fetch all open positions
    const positions = await step.do('fetch-positions', async () => {
      const results = await cantonQuery(env, POSITION_TEMPLATE, { status: 'Open' });
      console.log(`Found ${results.length} open positions`);
      return results as PositionContract[];
    });

    if (positions.length === 0) {
      console.log('No open positions to monitor');
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
      return await fetchLivePrices(env.COINMARKETCAP_API_KEY);
    });

    // Step 4: Compute PnL and LTVs
    //   PnL: Long = units * (currentPrice - entryPrice), Short = reverse
    //   LTV: totalNotional / (collateral + totalPnL)
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
        // LTV = aggregate notional / effective collateral (same for all positions on this vault)
        const totalNotional = agg?.totalNotional || notional;
        const ltv = effectiveCollateral > 0 ? totalNotional / effectiveCollateral : (totalNotional > 0 ? Infinity : 0);

        return {
          contractId: pos.contractId,
          positionId: pos.payload.positionId,
          vaultId: pos.payload.vaultId,
          fund: pos.payload.fund,
          broker: pos.payload.broker,
          operator: pos.payload.operator,
          notional,
          collateralValue,
          pnl,
          currentLTV: ltv === Infinity ? 999 : ltv,
        };
      });
    });

    // Step 5: Fetch LTV thresholds from BrokerFundLink
    const brokerFundPairs = [...new Set(positions.map(p => `${p.payload.broker}|${p.payload.fund}`))];

    const thresholds = await step.do('fetch-thresholds', async () => {
      const thresholdMap: Record<string, number> = {};
      for (const pair of brokerFundPairs) {
        const [broker, fund] = pair.split('|');
        const results = await cantonQuery(env, LINK_TEMPLATE, { broker, fund });
        if (results.length > 0) {
          const link = results[0] as LinkContract;
          thresholdMap[pair] = parseFloat(link.payload.ltvThreshold) || 0.8;
        } else {
          thresholdMap[pair] = 0.8;
        }
      }
      return thresholdMap;
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

    // Step 6: Create margin calls for breaches
    let marginCallsCreated = 0;

    for (const result of ltvResults) {
      const pairKey = `${result.broker}|${result.fund}`;
      const threshold = thresholds[pairKey] || 0.8;

      if (result.currentLTV >= threshold) {
        try {
          await step.do(`margin-call-${result.positionId}`, async () => {
            // Create WorkflowMarginCall
            const requiredAmount = result.notional - (result.collateralValue * threshold);
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
            await cantonExercise(
              env,
              result.contractId,
              POSITION_TEMPLATE,
              'MarkMarginCalled',
              {}
            );

            // Auto-liquidate if enabled for this broker-fund pair (from KV)
            if (autoLiqFlags[pairKey]) {
              const vault = vaults[result.vaultId];
              let liquidatedAmount = requiredAmount;

              if (vault && env.DEPLOYER_PRIVATE_KEY && env.CANTON_AUTH_SECRET) {
                try {
                  const liqResult = await executeLiquidation({
                    env,
                    position: {
                      contractId: result.contractId,
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
                  });

                  if (liqResult.totalSeizedUSD > 0) {
                    liquidatedAmount = liqResult.totalSeizedUSD;
                  }

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

              // Always exercise LiquidatePosition on Canton (even if seizure partially failed)
              await cantonExercise(env, result.contractId, POSITION_TEMPLATE, 'LiquidatePosition', {
                ltvThreshold: threshold.toString(),
                liquidatedAmount: liquidatedAmount.toString(),
                liquidatedAt: new Date().toISOString(),
              });
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

    // Step 7: Update all position LTVs
    for (const result of ltvResults) {
      if (result.currentLTV < (thresholds[`${result.broker}|${result.fund}`] || 0.8)) {
        // Only update non-breached positions (breached ones were already updated via MarkMarginCalled)
        try {
          await step.do(`update-ltv-${result.positionId}`, async () => {
            await cantonExercise(
              env,
              result.contractId,
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

      // Maintain rolling index of last 100 timestamps
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
