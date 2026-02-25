/**
 * POST /api/custodian/accept-deposit
 *
 * After the user creates a CC transfer offer (sdk.transfer → custodian),
 * this function accepts it on the custodian's behalf so the CC actually moves.
 *
 * Body: { contractId } — the transfer offer contract ID returned by sdk.transfer
 * Auth: same-origin only
 * Returns: { success }
 */

import * as jwt from 'jsonwebtoken';

interface Env {
  SPLICE_HOST: string;
  SPLICE_PORT: string;
  CANTON_AUTH_SECRET: string;
  CANTON_AUTH_AUDIENCE: string;
  CUSTODIAN_USER: string;
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
      sub: env.CUSTODIAN_USER || 'vault-custodian',
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    env.CANTON_AUTH_SECRET || 'unsafe',
    { algorithm: 'HS256' }
  );
}

function getBaseUrl(env: Env): string {
  const host = env.SPLICE_HOST || 'p1.cantondefi.com';
  const port = parseInt(env.SPLICE_PORT || '443');
  const protocol = port === 443 ? 'https' : 'http';
  const portStr = port === 443 ? '' : `:${port}`;
  return `${protocol}://${host}${portStr}/api/validator/v0`;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  // Same-origin check
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await request.json() as { contractId?: string };

    if (body.contractId) {
      // Accept a specific transfer offer by contract ID
      const token = generateToken(env);
      const baseUrl = getBaseUrl(env);
      const res = await fetch(`${baseUrl}/wallet/transfer-offers/${body.contractId}/accept`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Accept failed: ${res.status} - ${errText}`);
      }

      return jsonResponse({ success: true, accepted: body.contractId });
    }

    // No specific contract ID — list and accept ALL pending offers for the custodian
    const token = generateToken(env);
    const baseUrl = getBaseUrl(env);

    const listRes = await fetch(`${baseUrl}/wallet/transfer-offers`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!listRes.ok) {
      const errText = await listRes.text();
      throw new Error(`List offers failed: ${listRes.status} - ${errText}`);
    }

    const offersData = await listRes.json() as { offers?: Array<{ contract_id: string }> } | Array<{ contract_id: string }>;
    const offers = Array.isArray(offersData) ? offersData : (offersData?.offers || []);

    const accepted: string[] = [];
    for (const offer of offers) {
      const cid = offer.contract_id;
      if (!cid) continue;
      try {
        const acceptRes = await fetch(`${baseUrl}/wallet/transfer-offers/${cid}/accept`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        });
        if (acceptRes.ok) {
          accepted.push(cid);
        } else {
          console.warn(`[custodian] Failed to accept offer ${cid}: ${acceptRes.status}`);
        }
      } catch (err) {
        console.warn(`[custodian] Error accepting offer ${cid}:`, err);
      }
    }

    return jsonResponse({ success: true, accepted, total: offers.length });
  } catch (error) {
    console.error('[custodian/accept-deposit] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Accept failed',
    }, 500);
  }
};
