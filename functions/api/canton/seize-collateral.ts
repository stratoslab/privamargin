/**
 * POST /api/canton/seize-collateral
 *
 * Server-side function that exercises SeizeCollateral on a CollateralVault.
 * SeizeCollateral has `controller operator` which the frontend broker can't
 * exercise via the wallet SDK. This endpoint authenticates directly to the
 * Canton JSON API using JWT signed with CANTON_AUTH_SECRET.
 *
 * Body: { contractId, templateId, assetId, seizeAmount, reason }
 * Returns: { success, newContractId }
 */

interface Env {
  CANTON_HOST: string;
  CANTON_AUTH_SECRET: string;
  CANTON_AUTH_USER: string;
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
    encoder.encode(env.CANTON_AUTH_SECRET),
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
    if (!cantonHost || !env.CANTON_AUTH_SECRET) {
      return jsonResponse({ error: 'Canton API not configured' }, 500);
    }

    const token = await generateCantonToken(env);

    const response = await fetch(`https://${cantonHost}/v1/exercise`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        templateId,
        contractId,
        choice: 'SeizeCollateral',
        argument: {
          assetId,
          seizeAmount,
          reason: reason || 'Liquidation seizure',
        },
      }),
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
