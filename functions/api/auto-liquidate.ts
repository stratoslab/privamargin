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

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const broker = url.searchParams.get('broker');
    const fund = url.searchParams.get('fund');

    if (!broker) {
      return new Response(
        JSON.stringify({ error: 'broker query parameter is required' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (fund) {
      // Single broker-fund lookup
      const value = await env.PRIVAMARGIN_CONFIG.get(`auto_liquidate:${broker}|${fund}`);
      return new Response(
        JSON.stringify({ enabled: value === 'true' }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // Bulk lookup: all preferences for a broker
    const list = await env.PRIVAMARGIN_CONFIG.list({ prefix: `auto_liquidate:${broker}|` });
    const preferences: Record<string, boolean> = {};
    for (const key of list.keys) {
      // key.name = "auto_liquidate:<broker>|<fund>"
      const fundId = key.name.slice(`auto_liquidate:${broker}|`.length);
      const value = await env.PRIVAMARGIN_CONFIG.get(key.name);
      preferences[fundId] = value === 'true';
    }

    return new Response(
      JSON.stringify({ preferences }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch auto-liquidate preferences' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as { broker?: string; fund?: string; enabled?: boolean };

    if (!body.broker || !body.fund || typeof body.enabled !== 'boolean') {
      return new Response(
        JSON.stringify({ success: false, error: 'broker, fund, and enabled (boolean) are required' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    await env.PRIVAMARGIN_CONFIG.put(
      `auto_liquidate:${body.broker}|${body.fund}`,
      body.enabled ? 'true' : 'false'
    );

    return new Response(
      JSON.stringify({ success: true, broker: body.broker, fund: body.fund, enabled: body.enabled }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to save auto-liquidate preference' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
