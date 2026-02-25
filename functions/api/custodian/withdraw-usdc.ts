/**
 * POST /api/custodian/withdraw-usdc
 *
 * Server-side function that transfers USDCHolding from the vault custodian
 * back to a user on Canton. Uses Canton JSON API v2 to exercise the
 * Split + Transfer choices on the USDCHolding Daml contract.
 *
 * Body: { receiverParty: string, amount: number }
 * Auth: same-origin only (called from the privamargin frontend)
 * Returns: { success, contractId }
 */

import * as jwt from 'jsonwebtoken';

interface Env {
  CANTON_JSON_HOST: string;
  CANTON_AUTH_SECRET: string;
  CANTON_AUTH_AUDIENCE: string;
  SPLICE_ADMIN_USER: string;
  USDC_TEMPLATE_ID: string;
  PRIVAMARGIN_CONFIG: KVNamespace;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function generateToken(env: Env): string {
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

function getBaseUrl(env: Env): string {
  const host = env.CANTON_JSON_HOST || 'localhost';
  return `https://${host}/v2`;
}

async function cantonFetch<T>(env: Env, endpoint: string, body?: unknown): Promise<T> {
  const token = generateToken(env);
  const url = `${getBaseUrl(env)}${endpoint}`;
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

  // Same-origin check
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await request.json() as {
      receiverParty: string;
      amount: number;
    };

    const { receiverParty, amount } = body;
    if (!receiverParty || !amount || amount <= 0) {
      return jsonResponse({ error: 'Missing receiverParty or amount' }, 400);
    }

    const templateId = env.USDC_TEMPLATE_ID;
    if (!templateId) {
      return jsonResponse({ error: 'USDC_TEMPLATE_ID not configured' }, 500);
    }

    // Get admin party (issuer) — needed to exercise Split/Transfer choices
    const adminUser = await cantonFetch<{ user: { primaryParty: string } }>(
      env, `/users/${env.SPLICE_ADMIN_USER || 'app-user'}`
    );
    const adminPartyId = adminUser.user.primaryParty;

    // Get custodian party from KV (this is the owner of deposited USDCHoldings)
    const custodianParty = await env.PRIVAMARGIN_CONFIG.get('custodianParty');
    if (!custodianParty) {
      return jsonResponse({ error: 'Custodian party not configured' }, 500);
    }

    // Query custodian's USDCHolding contracts
    const offset = await cantonFetch<{ offset: number }>(env, '/state/ledger-end');
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
      filter: { filtersByParty },
      verbose: true,
      activeAtOffset: offset.offset,
    });

    // Parse and filter for custodian's holdings
    const contracts = (rawContracts || [])
      .map(c => ({
        contractId: c.contractEntry.JsActiveContract.createdEvent.contractId,
        tid: c.contractEntry.JsActiveContract.createdEvent.templateId,
        payload: c.contractEntry.JsActiveContract.createdEvent.createArgument,
      }))
      .filter(c => c.tid === templateId && c.payload.owner === custodianParty);

    // Check balance
    let available = 0;
    for (const c of contracts) {
      available += parseFloat(c.payload.amount as string) || 0;
    }

    if (available < amount) {
      return jsonResponse({ error: `Insufficient custodian USDC: have ${available}, need ${amount}` }, 400);
    }

    // Find a contract that covers the amount, Split if needed, Transfer to receiver
    const sorted = [...contracts].sort((a, b) =>
      (parseFloat(b.payload.amount as string) || 0) - (parseFloat(a.payload.amount as string) || 0)
    );

    let remaining = amount;
    const transferredIds: string[] = [];

    for (const contract of sorted) {
      if (remaining <= 0) break;
      const contractAmount = parseFloat(contract.payload.amount as string) || 0;

      if (contractAmount <= remaining) {
        // Transfer entire contract
        await exerciseChoice(env, adminPartyId, contract.contractId, templateId, 'Transfer', { newOwner: receiverParty });
        transferredIds.push(contract.contractId);
        remaining -= contractAmount;
      } else {
        // Split: take what we need
        const splitResult = await exerciseChoice(env, adminPartyId, contract.contractId, templateId, 'Split', { splitAmount: remaining.toString() });

        // Find the created contract with the split amount and transfer it
        const createdEvents = splitResult.created || [];
        for (const evt of createdEvents) {
          const evtAmount = parseFloat(evt.payload.amount as string) || 0;
          if (Math.abs(evtAmount - remaining) < 0.000001) {
            await exerciseChoice(env, adminPartyId, evt.contractId, templateId, 'Transfer', { newOwner: receiverParty });
            transferredIds.push(evt.contractId);
            break;
          }
        }
        remaining = 0;
      }
    }

    console.log(`[custodian/withdraw-usdc] Transferred ${amount} USDC to ${receiverParty}, contracts: ${transferredIds.join(', ')}`);

    return jsonResponse({
      success: true,
      contractId: transferredIds[0] || '',
      amount,
      receiverParty,
    });
  } catch (error) {
    console.error('[custodian/withdraw-usdc] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'USDC withdrawal failed',
    }, 500);
  }
};

// Exercise a choice on a USDCHolding contract via Canton JSON API v2
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
