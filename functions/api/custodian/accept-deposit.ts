/**
 * POST /api/custodian/accept-deposit
 *
 * After the user creates a CC transfer offer (sdk.transfer → custodian),
 * this function accepts it on the custodian's behalf so the CC actually moves.
 * Uses the devportal proxy API to exercise AcceptTransferOffer as the custodian.
 *
 * Body: { contractId } — the transfer offer contract ID returned by sdk.transfer
 * Auth: same-origin only
 * Returns: { success }
 */

import { proxyExercise } from '../../_lib/proxy-client';

interface Env {
  PROXY_API_URL: string;
  PROXY_API_KEY: string;
  TRANSFER_OFFER_TEMPLATE_ID?: string;
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
    if (!env.PROXY_API_URL || !env.PROXY_API_KEY) {
      return jsonResponse({ error: 'Proxy API not configured' }, 500);
    }

    const body = await request.json() as { contractId?: string; templateId?: string };

    if (!body.contractId) {
      return jsonResponse({ error: 'contractId is required' }, 400);
    }

    const templateId = body.templateId || env.TRANSFER_OFFER_TEMPLATE_ID || '';
    if (!templateId) {
      return jsonResponse({ error: 'templateId required (pass in body or set TRANSFER_OFFER_TEMPLATE_ID)' }, 400);
    }

    console.log(`[custodian/accept-deposit] Accepting transfer offer ${body.contractId}`);

    await proxyExercise(env.PROXY_API_URL, env.PROXY_API_KEY, body.contractId, templateId, 'TransferOffer_Accept', {});

    return jsonResponse({ success: true, accepted: body.contractId });
  } catch (error) {
    console.error('[custodian/accept-deposit] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Accept failed',
    }, 500);
  }
};
