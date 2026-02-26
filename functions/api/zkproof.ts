interface Env {
  PRIVAMARGIN_CONFIG: KVNamespace;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const ZK_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as { hash?: string; proof?: unknown };
    if (!body.hash || !body.proof) {
      return new Response(
        JSON.stringify({ error: 'Missing hash or proof' }),
        { status: 400, headers: CORS_HEADERS },
      );
    }

    await env.PRIVAMARGIN_CONFIG.put(
      `zkproof:${body.hash}`,
      JSON.stringify(body.proof),
      { expirationTtl: ZK_TTL_SECONDS },
    );

    return new Response(
      JSON.stringify({ success: true, hash: body.hash }),
      { status: 200, headers: CORS_HEADERS },
    );
  } catch {
    return new Response(
      JSON.stringify({ error: 'Failed to store proof' }),
      { status: 500, headers: CORS_HEADERS },
    );
  }
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const hash = url.searchParams.get('hash');
    if (!hash) {
      return new Response(
        JSON.stringify({ error: 'Missing hash parameter' }),
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const raw = await env.PRIVAMARGIN_CONFIG.get(`zkproof:${hash}`);
    if (!raw) {
      return new Response(
        JSON.stringify({ error: 'Proof not found' }),
        { status: 404, headers: CORS_HEADERS },
      );
    }

    return new Response(
      JSON.stringify({ proof: JSON.parse(raw) }),
      { status: 200, headers: CORS_HEADERS },
    );
  } catch {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch proof' }),
      { status: 500, headers: CORS_HEADERS },
    );
  }
};
