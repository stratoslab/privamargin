/**
 * POST /api/canton/seize-collateral
 *
 * Server-side function that exercises SeizeCollateral on a CollateralVault.
 * SeizeCollateral has `controller operator` which the frontend broker can't
 * exercise via the wallet SDK. This endpoint authenticates to the Canton
 * JSON API using CANTON_AUTH_TOKEN (same token the workflow uses) and acts
 * as the OPERATOR_PARTY.
 *
 * Body: { contractId, templateId, assetId, seizeAmount, reason }
 * Returns: { success, newContractId }
 */

interface Env {
  CANTON_HOST: string;
  CANTON_AUTH_TOKEN: string;
  OPERATOR_PARTY?: string;
  PRIVAMARGIN_CONFIG: KVNamespace;
  // Fallback: self-signed JWT
  CANTON_AUTH_SECRET?: string;
  CANTON_AUTH_USER?: string;
  CANTON_AUTH_AUDIENCE?: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function generateCantonToken(env: Env): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: env.CANTON_AUTH_USER || 'app-user',
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
    'raw',
    encoder.encode(env.CANTON_AUTH_SECRET!),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput))
  );

  return `${signingInput}.${b64url(signature)}`;
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

    const cantonHost = env.CANTON_HOST;
    if (!cantonHost) {
      return jsonResponse({ error: 'CANTON_HOST not configured' }, 500);
    }

    // Use the same auth token as the workflow (has proper party claims)
    const token = env.CANTON_AUTH_TOKEN || (env.CANTON_AUTH_SECRET ? await generateCantonToken(env) : '');
    if (!token) {
      return jsonResponse({ error: 'No CANTON_AUTH_TOKEN or CANTON_AUTH_SECRET configured' }, 500);
    }

    // Resolve operator party from env var or KV config
    const operatorParty = env.OPERATOR_PARTY || await env.PRIVAMARGIN_CONFIG?.get('operatorParty') || '';

    // Build exercise body with explicit actAs operator party
    const exerciseBody: Record<string, unknown> = {
      templateId,
      contractId,
      choice: 'SeizeCollateral',
      argument: {
        assetId,
        seizeAmount,
        reason: reason || 'Liquidation seizure',
      },
    };

    // Include actAs in meta so Canton knows which party is exercising
    if (operatorParty) {
      exerciseBody.meta = {
        actAs: [operatorParty],
      };
    }

    console.log(`[seize-collateral] Exercising SeizeCollateral: asset=${assetId}, amount=${seizeAmount}, cid=${contractId.slice(0, 16)}..., operator=${operatorParty || 'MISSING'}`);

    const response = await fetch(`https://${cantonHost}/v1/exercise`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(exerciseBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[seize-collateral] Canton exercise failed: ${response.status} ${errText}`);
      return jsonResponse({ success: false, error: `Canton API: ${response.status} ${errText}` }, 502);
    }

    const result = await response.json() as { result?: { exerciseResult?: string } };
    const newContractId = result?.result?.exerciseResult || '';

    console.log(`[seize-collateral] SeizeCollateral OK: ${assetId} ${seizeAmount} → newCid=${newContractId}`);
    return jsonResponse({ success: true, newContractId });
  } catch (error) {
    console.error('[seize-collateral] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'SeizeCollateral failed',
    }, 500);
  }
};
