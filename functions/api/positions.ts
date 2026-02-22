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

// KV-backed fallback for positions
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const fund = url.searchParams.get('fund');
    const broker = url.searchParams.get('broker');

    const raw = await env.PRIVAMARGIN_CONFIG.get('positions');
    const positions: any[] = raw ? JSON.parse(raw) : [];

    let filtered = positions;
    if (fund) {
      filtered = filtered.filter((p: any) => p.fund === fund);
    }
    if (broker) {
      filtered = filtered.filter((p: any) => p.broker === broker);
    }

    return new Response(
      JSON.stringify({ positions: filtered }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch positions' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as {
      fund?: string;
      broker?: string;
      operator?: string;
      vaultId?: string;
      description?: string;
      notionalValue?: number;
      action?: string;
      positionId?: string;
    };

    const raw = await env.PRIVAMARGIN_CONFIG.get('positions');
    const positions: any[] = raw ? JSON.parse(raw) : [];

    if (body.action === 'close' && body.positionId) {
      const idx = positions.findIndex((p: any) => p.positionId === body.positionId);
      if (idx >= 0) {
        positions[idx].status = 'Closed';
        await env.PRIVAMARGIN_CONFIG.put('positions', JSON.stringify(positions));
        return new Response(
          JSON.stringify({ success: true, position: positions[idx] }),
          { status: 200, headers: CORS_HEADERS }
        );
      }
      return new Response(
        JSON.stringify({ error: 'Position not found' }),
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // Create new position
    if (!body.fund || !body.broker || !body.vaultId || !body.notionalValue) {
      return new Response(
        JSON.stringify({ error: 'fund, broker, vaultId, and notionalValue are required' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const position = {
      positionId: `POS-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      fund: body.fund,
      broker: body.broker,
      operator: body.operator || body.fund,
      vaultId: body.vaultId,
      description: body.description || '',
      notionalValue: body.notionalValue,
      collateralValue: 0,
      currentLTV: 0,
      status: 'Open',
      createdAt: new Date().toISOString(),
      lastChecked: new Date().toISOString(),
    };

    positions.push(position);
    await env.PRIVAMARGIN_CONFIG.put('positions', JSON.stringify(positions));

    return new Response(
      JSON.stringify({ success: true, position }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to process position' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
