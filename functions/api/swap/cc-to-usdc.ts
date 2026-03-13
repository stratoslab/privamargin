/**
 * POST /api/swap/cc-to-usdc
 *
 * Swaps CC held by the custodian for USDC from the bridge operator.
 * 1. Custodian transfers CC to bridge operator (proxy exercise Transfer)
 * 2. Bridge operator sends equivalent USDC to custodian (proxy exercise Transfer)
 *
 * Body: { ccAmount: number, usdcAmount: number }
 * Auth: same-origin only (called from privamargin frontend after liquidation)
 */

import { proxyQuery, proxyExercise } from '../../_lib/proxy-client';

interface Env {
  PROXY_API_URL: string;
  PROXY_API_KEY: string;
  CC_TEMPLATE_ID: string;
  USDC_TEMPLATE_ID: string;
  CUSTODIAN_PARTY: string;
  BRIDGE_OPERATOR_PARTY: string;
  PRIVAMARGIN_CONFIG: KVNamespace;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

    if (!env.PROXY_API_URL || !env.PROXY_API_KEY) {
      return jsonResponse({ error: 'Proxy API not configured' }, 500);
    }

    const custodianParty = env.CUSTODIAN_PARTY;
    const bridgeParty = env.BRIDGE_OPERATOR_PARTY || await env.PRIVAMARGIN_CONFIG?.get('bridgeOperatorParty') || '';
    if (!custodianParty || !bridgeParty) {
      return jsonResponse({ error: 'CUSTODIAN_PARTY or BRIDGE_OPERATOR_PARTY not configured' }, 500);
    }

    // ── Step 1: Transfer CC from custodian to bridge operator ──────────
    const ccTemplateId = env.CC_TEMPLATE_ID || await env.PRIVAMARGIN_CONFIG?.get('CC_TEMPLATE_ID') || '';
    if (!ccTemplateId) {
      return jsonResponse({ error: 'CC_TEMPLATE_ID not configured' }, 500);
    }

    const ccContracts = await proxyQuery(env.PROXY_API_URL, env.PROXY_API_KEY, ccTemplateId);
    const custodianCC = ccContracts.filter(c => c.payload.owner === custodianParty);

    let ccAvailable = 0;
    for (const c of custodianCC) {
      ccAvailable += parseFloat(c.payload.amount as string) || 0;
    }
    if (ccAvailable < ccAmount) {
      return jsonResponse({ error: `Insufficient custodian CC: have ${ccAvailable}, need ${ccAmount}` }, 400);
    }

    // Sort and transfer CC
    const ccSorted = [...custodianCC].sort((a, b) =>
      (parseFloat(b.payload.amount as string) || 0) - (parseFloat(a.payload.amount as string) || 0)
    );

    let ccRemaining = ccAmount;
    let ccTransferred = false;

    for (const contract of ccSorted) {
      if (ccRemaining <= 0) break;
      const amt = parseFloat(contract.payload.amount as string) || 0;

      if (amt <= ccRemaining) {
        await proxyExercise(env.PROXY_API_URL, env.PROXY_API_KEY, contract.contractId, ccTemplateId, 'Transfer', { newOwner: bridgeParty });
        ccRemaining -= amt;
      } else {
        const splitResult = await proxyExercise(env.PROXY_API_URL, env.PROXY_API_KEY, contract.contractId, ccTemplateId, 'Split', { splitAmount: ccRemaining.toString() });
        for (const evt of (splitResult.events || [])) {
          const evtAmt = parseFloat(evt.payload.amount as string) || 0;
          if (Math.abs(evtAmt - ccRemaining) < 0.000001) {
            await proxyExercise(env.PROXY_API_URL, env.PROXY_API_KEY, evt.contractId, ccTemplateId, 'Transfer', { newOwner: bridgeParty });
            break;
          }
        }
        ccRemaining = 0;
      }
    }
    ccTransferred = ccRemaining <= 0;

    console.log(`[cc-to-usdc] Step 1: custodian→bridge ${ccAmount} CC, transferred=${ccTransferred}`);

    // ── Step 2: Transfer USDC from bridge operator to custodian ────────
    const usdcTemplateId = env.USDC_TEMPLATE_ID;
    if (!usdcTemplateId) {
      return jsonResponse({ error: 'USDC_TEMPLATE_ID not configured', ccTransferred }, 500);
    }

    const usdcContracts = await proxyQuery(env.PROXY_API_URL, env.PROXY_API_KEY, usdcTemplateId);
    const bridgeUSDC = usdcContracts.filter(c => c.payload.owner === bridgeParty);

    let usdcAvailable = 0;
    for (const c of bridgeUSDC) {
      usdcAvailable += parseFloat(c.payload.amount as string) || 0;
    }
    if (usdcAvailable < usdcAmount) {
      return jsonResponse({
        error: `Bridge operator insufficient USDC: have ${usdcAvailable.toFixed(6)}, need ${usdcAmount}`,
        ccTransferred,
      }, 400);
    }

    const usdcSorted = [...bridgeUSDC].sort((a, b) =>
      (parseFloat(b.payload.amount as string) || 0) - (parseFloat(a.payload.amount as string) || 0)
    );

    let usdcRemaining = usdcAmount;
    const transferredIds: string[] = [];

    for (const contract of usdcSorted) {
      if (usdcRemaining <= 0) break;
      const amt = parseFloat(contract.payload.amount as string) || 0;

      if (amt <= usdcRemaining) {
        await proxyExercise(env.PROXY_API_URL, env.PROXY_API_KEY, contract.contractId, usdcTemplateId, 'Transfer', { newOwner: custodianParty });
        transferredIds.push(contract.contractId);
        usdcRemaining -= amt;
      } else {
        const splitResult = await proxyExercise(env.PROXY_API_URL, env.PROXY_API_KEY, contract.contractId, usdcTemplateId, 'Split', {
          splitAmount: usdcRemaining.toFixed(10),
        });
        for (const evt of (splitResult.events || [])) {
          const evtAmt = parseFloat(evt.payload.amount as string) || 0;
          if (Math.abs(evtAmt - usdcRemaining) < 0.000001) {
            await proxyExercise(env.PROXY_API_URL, env.PROXY_API_KEY, evt.contractId, usdcTemplateId, 'Transfer', { newOwner: custodianParty });
            transferredIds.push(evt.contractId);
            break;
          }
        }
        usdcRemaining = 0;
      }
    }

    console.log(`[cc-to-usdc] Step 2: bridge→custodian ${usdcAmount} USDC, contracts=${transferredIds.length}`);

    return jsonResponse({
      success: true,
      ccTransferred,
      usdcReceived: transferredIds.length > 0,
      ccAmount,
      usdcAmount,
    });
  } catch (error) {
    console.error('[cc-to-usdc] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'CC→USDC swap failed',
    }, 500);
  }
};
