/**
 * POST /api/custodian/withdraw
 *
 * Transfers CC (Amulet) from the vault custodian to the vault owner.
 * Uses the devportal proxy's /api/proxy/cc-transfer endpoint which
 * handles the Splice TransferPreapproval internally. The sender is
 * locked to the API key's bound party (custodian).
 *
 * Body: { receiverParty: string, amount: number }
 * Auth: same-origin only
 * Returns: { success, amount, receiverParty }
 */

interface Env {
  PROXY_API_URL: string;
  PROXY_API_KEY: string;
  CUSTODIAN_PARTY: string;
  PRIVAMARGIN_CONFIG: KVNamespace;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

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

    if (!env.PROXY_API_URL || !env.PROXY_API_KEY) {
      return jsonResponse({ error: 'Proxy API not configured' }, 500);
    }

    // Transfer CC via proxy — sender is locked to the custodian's API key
    const baseUrl = env.PROXY_API_URL.replace(/\/(query|exercise|create)$/, '');
    const res = await fetch(`${baseUrl}/cc-transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.PROXY_API_KEY,
      },
      body: JSON.stringify({
        receiverParty,
        amount: amount.toString(),
        description: 'Vault CC withdrawal',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`CC transfer failed (${res.status}): ${errText}`);
    }

    const result = await res.json() as { success: boolean; error?: string };
    if (!result.success) {
      throw new Error((result as any).error || 'CC transfer failed');
    }

    console.log(`[custodian/withdraw] Transferred ${amount} CC to ${receiverParty} via proxy`);

    return jsonResponse({
      success: true,
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
