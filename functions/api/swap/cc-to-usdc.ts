/**
 * POST /api/swap/cc-to-usdc
 *
 * Swaps CC held by the custodian for USDC from the bridge operator.
 * 1. Custodian sends CC to bridge operator (Splice TransferOffer + accept)
 * 2. Bridge operator sends equivalent USDC to custodian (USDCHolding Transfer)
 *
 * Body: { ccAmount: number, usdcAmount: number }
 *   ccAmount  — CC units to send to bridge
 *   usdcAmount — USDC to receive back (based on live CC price at liquidation time)
 *
 * Auth: same-origin only (called from privamargin frontend after liquidation)
 */

import * as jwt from 'jsonwebtoken';

interface Env {
  SPLICE_HOST: string;
  SPLICE_PORT: string;
  CANTON_JSON_HOST: string;
  CANTON_AUTH_SECRET: string;
  CANTON_AUTH_AUDIENCE: string;
  CUSTODIAN_USER: string;
  SPLICE_ADMIN_USER: string;
  USDC_TEMPLATE_ID: string;
  PRIVAMARGIN_CONFIG: KVNamespace;
  // Optional: override bridge operator Splice username (default: bridge-operator)
  BRIDGE_OPERATOR_USER?: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function generateSpliceToken(env: Env, user: string): string {
  return jwt.sign(
    {
      aud: env.CANTON_AUTH_AUDIENCE || 'https://canton.network.global',
      sub: user,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    env.CANTON_AUTH_SECRET || 'unsafe',
    { algorithm: 'HS256' },
  );
}

function getSpliceBaseUrl(env: Env): string {
  const host = env.SPLICE_HOST || 'p1.cantondefi.com';
  const port = parseInt(env.SPLICE_PORT || '443');
  const protocol = port === 443 ? 'https' : 'http';
  const portStr = port === 443 ? '' : `:${port}`;
  return `${protocol}://${host}${portStr}/api/validator/v0`;
}

function getCantonBaseUrl(env: Env): string {
  const host = env.CANTON_JSON_HOST || 'localhost';
  return `https://${host}/v2`;
}

function generateCantonToken(env: Env): string {
  return jwt.sign(
    {
      aud: env.CANTON_AUTH_AUDIENCE || 'https://canton.network.global',
      sub: env.SPLICE_ADMIN_USER || 'app-user',
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    env.CANTON_AUTH_SECRET || 'unsafe',
    { algorithm: 'HS256' },
  );
}

async function cantonFetch<T>(env: Env, endpoint: string, body?: unknown): Promise<T> {
  const token = generateCantonToken(env);
  const url = `${getCantonBaseUrl(env)}${endpoint}`;
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
    throw new Error(`Canton API ${res.status}: ${errText}`);
  }
  return res.json() as Promise<T>;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await request.json() as { ccAmount: number; usdcAmount: number };
    const { ccAmount, usdcAmount } = body;
    if (!ccAmount || ccAmount <= 0 || !usdcAmount || usdcAmount <= 0) {
      return jsonResponse({ error: 'Missing or invalid ccAmount / usdcAmount' }, 400);
    }

    const bridgeUser = env.BRIDGE_OPERATOR_USER || 'bridge-operator';
    const custodianUser = env.CUSTODIAN_USER || 'vault-custodian';
    const spliceBase = getSpliceBaseUrl(env);

    // ── Step 1: Resolve bridge operator party ────────────────────────
    // Get bridge operator's party from their Splice wallet status
    const bridgeToken = generateSpliceToken(env, bridgeUser);
    const bridgeStatusRes = await fetch(`${spliceBase}/wallet/status`, {
      headers: { 'Authorization': `Bearer ${bridgeToken}` },
    });
    if (!bridgeStatusRes.ok) {
      const err = await bridgeStatusRes.text();
      return jsonResponse({ error: `Bridge operator status failed: ${err}` }, 500);
    }
    const bridgeStatus = await bridgeStatusRes.json() as { party_id?: string; party?: string };
    const bridgeParty = bridgeStatus.party_id || bridgeStatus.party;
    if (!bridgeParty) {
      return jsonResponse({ error: 'Could not resolve bridge operator party' }, 500);
    }

    // ── Step 2: Custodian sends CC to bridge operator ────────────────
    const custodianToken = generateSpliceToken(env, custodianUser);
    const expiresAtMicros = (Date.now() + 60 * 60 * 1000) * 1000;
    const trackingId = `cc-swap-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const offerRes = await fetch(`${spliceBase}/wallet/transfer-offers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${custodianToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receiver_party_id: bridgeParty,
        amount: ccAmount.toString(),
        description: 'CC→USDC swap (liquidation)',
        expires_at: expiresAtMicros.toString(),
        tracking_id: trackingId,
      }),
    });
    if (!offerRes.ok) {
      const err = await offerRes.text();
      return jsonResponse({ error: `CC transfer offer failed: ${err}` }, 500);
    }
    const offerData = await offerRes.json() as { offer_contract_id?: string; contract_id?: string };
    const offerCid = offerData.offer_contract_id || offerData.contract_id || '';

    // Accept the offer as bridge operator
    let ccAccepted = false;
    if (offerCid) {
      const acceptRes = await fetch(`${spliceBase}/wallet/transfer-offers/${offerCid}/accept`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${bridgeToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      ccAccepted = acceptRes.ok;
      if (!ccAccepted) {
        console.warn(`[cc-to-usdc] Bridge operator failed to accept CC offer: ${acceptRes.status}`);
      }
    }

    console.log(`[cc-to-usdc] Step 1 done: custodian→bridge ${ccAmount} CC, offer=${offerCid}, accepted=${ccAccepted}`);

    // ── Step 3: Bridge operator sends USDC to custodian ──────────────
    const templateId = env.USDC_TEMPLATE_ID;
    if (!templateId) {
      return jsonResponse({
        error: 'USDC_TEMPLATE_ID not configured',
        ccTransferred: ccAccepted,
      }, 500);
    }

    // Get admin party
    const adminUser = await cantonFetch<{ user: { primaryParty: string } }>(
      env, `/users/${env.SPLICE_ADMIN_USER || 'app-user'}`
    );
    const adminPartyId = adminUser.user.primaryParty;

    // Get custodian party
    const custodianParty = await env.PRIVAMARGIN_CONFIG.get('custodianParty');
    if (!custodianParty) {
      return jsonResponse({
        error: 'custodianParty not configured in KV',
        ccTransferred: ccAccepted,
      }, 500);
    }

    // Query bridge operator's USDCHolding contracts
    const offset = await cantonFetch<{ offset: number }>(env, '/state/ledger-end');
    const rawContracts = await cantonFetch<Array<{
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
      filter: {
        filtersByParty: {
          [adminPartyId]: {
            cumulative: [{
              identifierFilter: {
                TemplateFilter: {
                  value: { templateId, includeCreatedEventBlob: false }
                }
              }
            }]
          }
        }
      },
      verbose: true,
      activeAtOffset: offset.offset,
    });

    // Filter for bridge operator's USDC holdings
    const contracts = (rawContracts || [])
      .map(c => ({
        contractId: c.contractEntry.JsActiveContract.createdEvent.contractId,
        tid: c.contractEntry.JsActiveContract.createdEvent.templateId,
        payload: c.contractEntry.JsActiveContract.createdEvent.createArgument,
      }))
      .filter(c => c.tid === templateId && c.payload.owner === bridgeParty);

    let available = 0;
    for (const c of contracts) {
      available += parseFloat(c.payload.amount as string) || 0;
    }

    if (available < usdcAmount) {
      return jsonResponse({
        error: `Bridge operator insufficient USDC: have ${available.toFixed(6)}, need ${usdcAmount}`,
        ccTransferred: ccAccepted,
      }, 400);
    }

    // Transfer USDC from bridge operator to custodian
    const sorted = [...contracts].sort((a, b) =>
      (parseFloat(b.payload.amount as string) || 0) - (parseFloat(a.payload.amount as string) || 0)
    );

    let remaining = usdcAmount;
    const transferredIds: string[] = [];

    for (const contract of sorted) {
      if (remaining <= 0) break;
      const contractAmount = parseFloat(contract.payload.amount as string) || 0;

      if (contractAmount <= remaining) {
        await exerciseChoice(env, adminPartyId, contract.contractId, templateId, 'Transfer', { newOwner: custodianParty });
        transferredIds.push(contract.contractId);
        remaining -= contractAmount;
      } else {
        const splitResult = await exerciseChoice(env, adminPartyId, contract.contractId, templateId, 'Split', {
          splitAmount: remaining.toFixed(10),
        });
        for (const evt of splitResult.created) {
          const evtAmount = parseFloat(evt.payload.amount as string) || 0;
          if (Math.abs(evtAmount - remaining) < 0.000001) {
            await exerciseChoice(env, adminPartyId, evt.contractId, templateId, 'Transfer', { newOwner: custodianParty });
            transferredIds.push(evt.contractId);
            break;
          }
        }
        remaining = 0;
      }
    }

    console.log(`[cc-to-usdc] Step 2 done: bridge→custodian ${usdcAmount} USDC, contracts=${transferredIds.length}`);

    return jsonResponse({
      success: true,
      ccTransferred: ccAccepted,
      usdcReceived: transferredIds.length > 0,
      ccAmount,
      usdcAmount,
      trackingId,
    });
  } catch (error) {
    console.error('[cc-to-usdc] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'CC→USDC swap failed',
    }, 500);
  }
};

async function exerciseChoice(
  env: Env,
  actAs: string,
  contractId: string,
  templateId: string,
  choice: string,
  argument: Record<string, unknown>,
): Promise<{ created: Array<{ contractId: string; payload: Record<string, unknown> }> }> {
  const commandId = crypto.randomUUID();
  const result = await cantonFetch<{
    transactionTree: {
      eventsById: Record<string, {
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
