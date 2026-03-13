/**
 * POST /api/canton/seize-collateral
 *
 * Server-side function that exercises SeizeCollateral on a CollateralVault.
 * Uses the devportal proxy API to exercise the choice as the custodian party.
 *
 * Body: { contractId, templateId, assetId, seizeAmount, reason }
 * Returns: { success, newContractId }
 */

import { proxyExercise } from '../../_lib/proxy-client';

interface Env {
  PROXY_API_URL: string;
  PROXY_API_KEY: string;
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
      contractId: string;
      templateId: string;
      assetId: string;
      seizeAmount: string;
      reason: string;
    };

    const { contractId, templateId, assetId, seizeAmount, reason } = body;
    if (!contractId || !templateId || !assetId || !seizeAmount) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    if (!env.PROXY_API_URL || !env.PROXY_API_KEY) {
      return jsonResponse({ error: 'Proxy API not configured' }, 500);
    }

    console.log(`[seize-collateral] Exercising SeizeCollateral: asset=${assetId}, amount=${seizeAmount}, cid=${contractId.slice(0, 16)}...`);

    const result = await proxyExercise(env.PROXY_API_URL, env.PROXY_API_KEY, contractId, templateId, 'SeizeCollateral', {
      assetId,
      seizeAmount,
      reason: reason || 'Liquidation seizure',
    });

    const newContractId = (result.exerciseResult as string) || '';

    console.log(`[seize-collateral] SeizeCollateral OK: ${assetId} ${seizeAmount} → newCid=${newContractId}`);
    return jsonResponse({ success: true, newContractId });
  } catch (error) {
    console.error('[seize-collateral] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'SeizeCollateral failed',
    }, 500);
  }
};
