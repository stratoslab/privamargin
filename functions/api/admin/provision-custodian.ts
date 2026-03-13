/**
 * Provision Vault Custodian Party
 *
 * POST: Accept a custodian party ID from the operator UI, or fall back to
 *       the CUSTODIAN_PARTY env var. Stores it in KV.
 * GET:  Check custodian status.
 */

interface Env {
  PRIVAMARGIN_CONFIG: KVNamespace;
  CUSTODIAN_PARTY?: string;
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
    // Accept partyId from request body, fall back to env var
    let custodianParty = '';
    try {
      const body = await request.json() as { partyId?: string };
      custodianParty = body.partyId || '';
    } catch {
      // empty body is OK — fall back to env
    }
    if (!custodianParty) {
      custodianParty = env.CUSTODIAN_PARTY || '';
    }
    if (!custodianParty) {
      return new Response(
        JSON.stringify({ success: false, error: 'No partyId provided and CUSTODIAN_PARTY not set' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Store in KV
    await env.PRIVAMARGIN_CONFIG.put('custodianParty', custodianParty);
    console.log(`Custodian party stored in KV: ${custodianParty}`);

    return new Response(
      JSON.stringify({
        success: true,
        custodianParty,
        message: 'Vault custodian configured successfully',
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error('Provision custodian failed:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Failed to provision custodian',
      }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const custodianParty = await env.PRIVAMARGIN_CONFIG.get('custodianParty');
    return new Response(
      JSON.stringify({
        provisioned: !!custodianParty,
        custodianParty: custodianParty || null,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to check custodian status' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
