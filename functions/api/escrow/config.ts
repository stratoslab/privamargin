/**
 * POST /api/escrow/config
 *
 * Stores the escrow deployer private key in KV so the operator
 * can configure it from the dashboard UI without wrangler secrets.
 *
 * Body: { privateKey: string }
 * Auth: same-origin only
 */

import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

interface Env {
  PRIVAMARGIN_CONFIG: KVNamespace;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await request.json() as { privateKey?: string };
    const rawKey = (body.privateKey || '').trim();

    if (!rawKey) {
      return jsonResponse({ error: 'privateKey is required' }, 400);
    }

    // Validate key by deriving the address
    const hex = rawKey.startsWith('0x') ? rawKey as Hex : `0x${rawKey}` as Hex;
    let deployerAddress: string;
    try {
      const account = privateKeyToAccount(hex);
      deployerAddress = account.address;
    } catch {
      return jsonResponse({ error: 'Invalid private key format' }, 400);
    }

    await env.PRIVAMARGIN_CONFIG.put('deployerPrivateKey', rawKey);

    return jsonResponse({
      success: true,
      deployerAddress,
      message: 'Escrow deployer configured',
    });
  } catch (err) {
    return jsonResponse({
      error: err instanceof Error ? err.message : 'Failed to configure deployer',
    }, 500);
  }
};
