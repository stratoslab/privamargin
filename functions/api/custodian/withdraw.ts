/**
 * POST /api/custodian/withdraw
 *
 * Server-side function that transfers CC from the vault custodian back to a user.
 * Called when a user withdraws CC from their vault.
 *
 * The custodian party creates a transfer offer on the Splice validator,
 * then immediately accepts it on the receiver's behalf so the CC actually moves.
 *
 * Body: { receiverParty, amount, receiverUser? }
 * Auth: same-origin only (called from the privamargin frontend)
 * Returns: { success, contractId, trackingId, accepted }
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
  // KV for looking up receiver usernames by party
  PRIVAMARGIN_CONFIG: KVNamespace;
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

function getSpliceBaseUrl(env: Env): string {
  const host = env.SPLICE_HOST || 'p1.cantondefi.com';
  const port = parseInt(env.SPLICE_PORT || '443');
  const protocol = port === 443 ? 'https' : 'http';
  const portStr = port === 443 ? '' : `:${port}`;
  return `${protocol}://${host}${portStr}/api/validator/v0`;
}

async function spliceRequest(env: Env, endpoint: string, body: unknown): Promise<unknown> {
  const baseUrl = getSpliceBaseUrl(env);
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

/**
 * Accept a transfer offer on behalf of the receiver.
 * Tries multiple auth strategies:
 * 1. receiverUser (explicit username) if provided
 * 2. Cached username from KV (party → username mapping)
 * 3. receiverParty directly as JWT sub (some validators support this)
 */
async function acceptOfferForReceiver(
  env: Env,
  contractId: string,
  receiverParty: string,
  receiverUser?: string,
): Promise<{ accepted: boolean; method?: string }> {
  const baseUrl = getSpliceBaseUrl(env);
  const acceptUrl = `${baseUrl}/wallet/transfer-offers/${contractId}/accept`;

  // Build list of JWT sub values to try
  const candidates: Array<{ sub: string; label: string }> = [];
  if (receiverUser) {
    candidates.push({ sub: receiverUser, label: 'explicit-user' });
  }
  // Check KV for cached party→username mapping
  const cachedUser = await env.PRIVAMARGIN_CONFIG.get(`splice-user:${receiverParty}`);
  if (cachedUser && cachedUser !== receiverUser) {
    candidates.push({ sub: cachedUser, label: 'cached-user' });
  }
  // Try the party ID directly (some validators support this)
  candidates.push({ sub: receiverParty, label: 'party-id' });

  for (const { sub, label } of candidates) {
    try {
      const token = generateToken(env, sub);
      const res = await fetch(acceptUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      if (res.ok) {
        // Cache the successful username mapping
        if (label !== 'party-id') {
          await env.PRIVAMARGIN_CONFIG.put(`splice-user:${receiverParty}`, sub);
        }
        console.log(`[custodian/withdraw] Accepted offer ${contractId} for receiver via ${label}`);
        return { accepted: true, method: label };
      }
      console.warn(`[custodian/withdraw] Accept via ${label} failed: ${res.status}`);
    } catch (err) {
      console.warn(`[custodian/withdraw] Accept via ${label} error:`, err);
    }
  }

  return { accepted: false };
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
      receiverUser?: string;
    };

    const { receiverParty, amount, receiverUser } = body;
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

    // Accept the offer on the receiver's behalf so CC actually moves
    // (the receiver's wallet may not auto-accept transfer offers)
    let accepted = false;
    if (contractId) {
      const acceptResult = await acceptOfferForReceiver(env, contractId, receiverParty, receiverUser);
      accepted = acceptResult.accepted;
      if (!accepted) {
        console.warn(`[custodian/withdraw] Could not auto-accept offer ${contractId} for ${receiverParty} — receiver must accept manually`);
      }
    }

    return jsonResponse({
      success: true,
      contractId,
      trackingId,
      amount,
      receiverParty,
      accepted,
    });
  } catch (error) {
    console.error('[custodian/withdraw] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Withdrawal failed',
    }, 500);
  }
};
