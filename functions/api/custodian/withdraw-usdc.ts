/**
 * POST /api/custodian/withdraw-usdc
 *
 * Server-side function that transfers USDCHolding from the vault custodian
 * back to a user. Uses the devportal proxy API to query and exercise
 * Split + Transfer choices on USDCHolding Daml contracts.
 *
 * Body: { receiverParty: string, amount: number }
 * Auth: same-origin only (called from the privamargin frontend)
 * Returns: { success, contractId }
 */

import { proxyQuery, proxyExercise } from '../../_lib/proxy-client';

interface Env {
  PROXY_API_URL: string;
  PROXY_API_KEY: string;
  USDC_TEMPLATE_ID: string;
  CUSTODIAN_PARTY: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

    if (!env.PROXY_API_URL || !env.PROXY_API_KEY) {
      return jsonResponse({ error: 'Proxy API not configured' }, 500);
    }

    const templateId = env.USDC_TEMPLATE_ID;
    if (!templateId) {
      return jsonResponse({ error: 'USDC_TEMPLATE_ID not configured' }, 500);
    }

    const custodianParty = env.CUSTODIAN_PARTY;
    if (!custodianParty) {
      return jsonResponse({ error: 'CUSTODIAN_PARTY not configured' }, 500);
    }

    // Query custodian's USDCHolding contracts via proxy
    const allContracts = await proxyQuery(env.PROXY_API_URL, env.PROXY_API_KEY, templateId);

    // Filter for custodian-owned holdings
    const contracts = allContracts.filter(c => c.payload.owner === custodianParty);

    // Check balance
    let available = 0;
    for (const c of contracts) {
      available += parseFloat(c.payload.amount as string) || 0;
    }

    if (available < amount) {
      return jsonResponse({ error: `Insufficient custodian USDC: have ${available}, need ${amount}` }, 400);
    }

    // Sort by amount descending, then Split if needed + Transfer to receiver
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
        await proxyExercise(env.PROXY_API_URL, env.PROXY_API_KEY, contract.contractId, templateId, 'Transfer', { newOwner: receiverParty });
        transferredIds.push(contract.contractId);
        remaining -= contractAmount;
      } else {
        // Split: take what we need
        const splitResult = await proxyExercise(env.PROXY_API_URL, env.PROXY_API_KEY, contract.contractId, templateId, 'Split', { splitAmount: remaining.toString() });

        // Find the created contract with the split amount and transfer it
        const createdEvents = splitResult.events || [];
        for (const evt of createdEvents) {
          const evtAmount = parseFloat(evt.payload.amount as string) || 0;
          if (Math.abs(evtAmount - remaining) < 0.000001) {
            await proxyExercise(env.PROXY_API_URL, env.PROXY_API_KEY, evt.contractId, templateId, 'Transfer', { newOwner: receiverParty });
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
