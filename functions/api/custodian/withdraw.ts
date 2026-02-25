/**
 * POST /api/custodian/withdraw
 *
 * Server-side function that transfers CC from the vault custodian back to a user.
 * Called when a user withdraws CC from their vault.
 *
 * The custodian party creates a transfer offer on the Splice validator,
 * which the user's wallet auto-accepts.
 *
 * Body: { receiverParty, amount }
 * Auth: same-origin only (called from the privamargin frontend)
 * Returns: { success, contractId, trackingId }
 */

import * as jwt from 'jsonwebtoken';

interface Env {
  // Splice validator connection (same node as the wallet)
  SPLICE_HOST: string;
  SPLICE_PORT: string;
  CANTON_AUTH_SECRET: string;
  CANTON_AUTH_AUDIENCE: string;
  // The custodian's username on the validator (used as JWT sub)
  CUSTODIAN_USER: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function generateToken(env: Env, user: string): string {
  return jwt.sign(
    {
      aud: env.CANTON_AUTH_AUDIENCE || 'https://canton.network.global',
      sub: user,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    env.CANTON_AUTH_SECRET || 'unsafe',
    { algorithm: 'HS256' }
  );
}

async function spliceRequest(env: Env, endpoint: string, body: unknown): Promise<unknown> {
  const host = env.SPLICE_HOST || 'p1.cantondefi.com';
  const port = parseInt(env.SPLICE_PORT || '443');
  const protocol = port === 443 ? 'https' : 'http';
  const portStr = port === 443 ? '' : `:${port}`;
  const baseUrl = `${protocol}://${host}${portStr}/api/validator/v0`;

  const token = generateToken(env, env.CUSTODIAN_USER || 'vault-custodian');

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Splice API ${res.status}: ${errText}`);
  }

  return res.json();
}

// POST /api/custodian/withdraw
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

    // Create a transfer offer from custodian → user
    const expiresAtMicros = (Date.now() + 60 * 60 * 1000) * 1000;
    const trackingId = `custodian-withdraw-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const result = await spliceRequest(env, '/wallet/transfer-offers', {
      receiver_party_id: receiverParty,
      amount: amount.toString(),
      description: 'Vault CC withdrawal',
      expires_at: expiresAtMicros.toString(),
      tracking_id: trackingId,
    }) as { offer_contract_id?: string; contract_id?: string; tracking_id?: string };

    const contractId = result.offer_contract_id || result.contract_id || '';

    return jsonResponse({
      success: true,
      contractId,
      trackingId,
      amount,
      receiverParty,
    });
  } catch (error) {
    console.error('[custodian/withdraw] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Withdrawal failed',
    }, 500);
  }
};
