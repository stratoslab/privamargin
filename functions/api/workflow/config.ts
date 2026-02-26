interface Env {
  PRIVAMARGIN_CONFIG: KVNamespace;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const ALLOWED_INTERVALS = [1, 5, 15, 30, 60];

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const raw = await env.PRIVAMARGIN_CONFIG.get('workflow:check_interval');
    const checkInterval = raw ? parseInt(raw, 10) : 15;
    return new Response(
      JSON.stringify({ checkInterval }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch workflow config' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as { checkInterval?: number };

    if (typeof body.checkInterval !== 'number' || !ALLOWED_INTERVALS.includes(body.checkInterval)) {
      return new Response(
        JSON.stringify({ success: false, error: `checkInterval must be one of: ${ALLOWED_INTERVALS.join(', ')}` }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    await env.PRIVAMARGIN_CONFIG.put('workflow:check_interval', String(body.checkInterval));

    return new Response(
      JSON.stringify({ success: true, checkInterval: body.checkInterval }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to save workflow config' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
