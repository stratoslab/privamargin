/**
 * GET/POST /api/admin/bridge-operator
 *
 * GET:  Returns the configured bridge operator party ID from KV.
 * POST: Stores a bridge operator party ID in KV.
 *       Body: { partyId: string }
 */

interface Env {
  PRIVAMARGIN_CONFIG: KVNamespace;
  BRIDGE_OPERATOR_PARTY?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  try {
    let partyId = '';
    try {
      const body = await request.json() as { partyId?: string };
      partyId = (body.partyId || '').trim();
    } catch {
      // empty body
    }
    if (!partyId) {
      partyId = env.BRIDGE_OPERATOR_PARTY || '';
    }
    if (!partyId) {
      return new Response(
        JSON.stringify({ success: false, error: 'No partyId provided' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    await env.PRIVAMARGIN_CONFIG.put('bridgeOperatorParty', partyId);

    return new Response(
      JSON.stringify({ success: true, bridgeOperatorParty: partyId }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Failed' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const partyId = await env.PRIVAMARGIN_CONFIG.get('bridgeOperatorParty') || env.BRIDGE_OPERATOR_PARTY || null;
    return new Response(
      JSON.stringify({ configured: !!partyId, bridgeOperatorParty: partyId }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to check bridge operator status' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
