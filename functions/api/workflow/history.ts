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
    const ts = url.searchParams.get('ts');

    // Single run detail lookup
    if (ts) {
      const record = await env.PRIVAMARGIN_CONFIG.get(`workflow:run:${ts}`);
      if (!record) {
        return new Response(
          JSON.stringify({ error: 'Run record not found' }),
          { status: 404, headers: CORS_HEADERS }
        );
      }
      return new Response(record, { status: 200, headers: CORS_HEADERS });
    }

    // List recent runs
    const limitParam = parseInt(url.searchParams.get('limit') || '20', 10);
    const limit = Math.min(Math.max(limitParam, 1), 100);

    const indexRaw = await env.PRIVAMARGIN_CONFIG.get('workflow:runs:index');
    if (!indexRaw) {
      return new Response(
        JSON.stringify({ runs: [] }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    const allTimestamps: string[] = JSON.parse(indexRaw);
    // Most recent first, take only what's requested
    const timestamps = allTimestamps.slice(-limit).reverse();

    const runs = await Promise.all(
      timestamps.map(async (t) => {
        const raw = await env.PRIVAMARGIN_CONFIG.get(`workflow:run:${t}`);
        if (!raw) return null;
        return JSON.parse(raw);
      })
    );

    return new Response(
      JSON.stringify({ runs: runs.filter(Boolean) }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch workflow history' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const record = await request.json() as { timestamp?: string; [key: string]: unknown };
    if (!record.timestamp) {
      return new Response(
        JSON.stringify({ error: 'Missing timestamp' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const ts = record.timestamp as string;

    // Write run record (30-day TTL)
    await env.PRIVAMARGIN_CONFIG.put(
      `workflow:run:${ts}`,
      JSON.stringify(record),
      { expirationTtl: 30 * 24 * 60 * 60 }
    );

    // Update rolling index
    const indexRaw = await env.PRIVAMARGIN_CONFIG.get('workflow:runs:index');
    const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
    index.push(ts);
    if (index.length > 100) index.splice(0, index.length - 100);
    await env.PRIVAMARGIN_CONFIG.put('workflow:runs:index', JSON.stringify(index));

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to persist run record' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
