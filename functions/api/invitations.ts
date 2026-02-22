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

// KV-backed fallback for invitations
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const fund = url.searchParams.get('fund');
    const broker = url.searchParams.get('broker');

    const raw = await env.PRIVAMARGIN_CONFIG.get('invitations');
    const invitations: any[] = raw ? JSON.parse(raw) : [];

    let filtered = invitations;
    if (fund) {
      filtered = filtered.filter((i: any) => i.fund === fund);
    }
    if (broker) {
      filtered = filtered.filter((i: any) => i.broker === broker);
    }

    return new Response(
      JSON.stringify({ invitations: filtered }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch invitations' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as {
      broker?: string;
      fund?: string;
      operator?: string;
      action?: string;
      invitationId?: string;
    };

    const raw = await env.PRIVAMARGIN_CONFIG.get('invitations');
    const invitations: any[] = raw ? JSON.parse(raw) : [];

    if (body.action === 'accept' && body.invitationId) {
      const idx = invitations.findIndex((i: any) => i.invitationId === body.invitationId);
      if (idx >= 0) {
        invitations[idx].status = 'Accepted';
        await env.PRIVAMARGIN_CONFIG.put('invitations', JSON.stringify(invitations));
        return new Response(
          JSON.stringify({ success: true, invitation: invitations[idx] }),
          { status: 200, headers: CORS_HEADERS }
        );
      }
      return new Response(
        JSON.stringify({ error: 'Invitation not found' }),
        { status: 404, headers: CORS_HEADERS }
      );
    }

    if (body.action === 'reject' && body.invitationId) {
      const idx = invitations.findIndex((i: any) => i.invitationId === body.invitationId);
      if (idx >= 0) {
        invitations.splice(idx, 1);
        await env.PRIVAMARGIN_CONFIG.put('invitations', JSON.stringify(invitations));
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: CORS_HEADERS }
        );
      }
      return new Response(
        JSON.stringify({ error: 'Invitation not found' }),
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // Create new invitation
    if (!body.broker || !body.fund) {
      return new Response(
        JSON.stringify({ error: 'broker and fund are required' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const invitation = {
      invitationId: `INV-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      broker: body.broker,
      fund: body.fund,
      operator: body.operator || body.broker,
      status: 'Pending',
      createdAt: new Date().toISOString(),
    };

    invitations.push(invitation);
    await env.PRIVAMARGIN_CONFIG.put('invitations', JSON.stringify(invitations));

    return new Response(
      JSON.stringify({ success: true, invitation }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to process invitation' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
