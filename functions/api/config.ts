interface Env {
  PRIVAMARGIN_CONFIG: KVNamespace;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

// Default platform assets (matches wallet SDK supported tokens)
const DEFAULT_PLATFORM_ASSETS = [
  { type: 'BTC', name: 'Bitcoin', category: 'Crypto' },
  { type: 'ETH', name: 'Ethereum', category: 'Crypto' },
  { type: 'SOL', name: 'Solana', category: 'Crypto' },
  { type: 'CC', name: 'Canton Coin', category: 'Crypto' },
  { type: 'USDC', name: 'USD Coin', category: 'Stablecoin' },
  { type: 'USDT', name: 'Tether', category: 'Stablecoin' },
  { type: 'TRX', name: 'Tron', category: 'Crypto' },
  { type: 'TON', name: 'Toncoin', category: 'Crypto' },
  { type: 'CUSD', name: 'CUSD', category: 'Stablecoin' },
];

// Known relay chain IDs to load from KV
const RELAY_CHAIN_IDS = [1, 11155111, 8453];

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const operatorParty = await env.PRIVAMARGIN_CONFIG.get('operatorParty');
    const custodianParty = await env.PRIVAMARGIN_CONFIG.get('custodianParty');
    const rawAssets = await env.PRIVAMARGIN_CONFIG.get('platformAssets');
    const platformAssets = rawAssets ? JSON.parse(rawAssets) : DEFAULT_PLATFORM_ASSETS;

    // Load relay addresses for all known chains
    const relayEntries: Record<string, string> = {};
    for (const chainId of RELAY_CHAIN_IDS) {
      const addr = await env.PRIVAMARGIN_CONFIG.get(`relay_${chainId}`);
      if (addr) {
        relayEntries[`relay_${chainId}`] = addr;
      }
    }

    return new Response(
      JSON.stringify({
        operatorParty: operatorParty || null,
        custodianParty: custodianParty || null,
        platformAssets,
        ...relayEntries,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch config' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as Record<string, unknown>;

    let saved = false;

    // Save operatorParty if provided
    if (typeof body.operatorParty === 'string') {
      await env.PRIVAMARGIN_CONFIG.put('operatorParty', body.operatorParty);
      saved = true;
    }

    // Save custodianParty if provided
    if (typeof body.custodianParty === 'string') {
      await env.PRIVAMARGIN_CONFIG.put('custodianParty', body.custodianParty);
      saved = true;
    }

    // Save platformAssets if provided
    if (Array.isArray(body.platformAssets)) {
      await env.PRIVAMARGIN_CONFIG.put('platformAssets', JSON.stringify(body.platformAssets));
      saved = true;
    }

    // Save relay_* keys (DepositRelay addresses per chain)
    for (const [key, value] of Object.entries(body)) {
      if (key.startsWith('relay_') && typeof value === 'string') {
        await env.PRIVAMARGIN_CONFIG.put(key, value);
        saved = true;
      }
    }

    if (!saved) {
      return new Response(
        JSON.stringify({ success: false, error: 'No valid config keys provided' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Config saved',
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to save config' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
