interface Env {
  PRIVAMARGIN_CONFIG: KVNamespace;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const partyId = url.searchParams.get('partyId');

    const rolesRaw = await env.PRIVAMARGIN_CONFIG.get('roles');
    const roles: Record<string, string> = rolesRaw ? JSON.parse(rolesRaw) : {};

    if (partyId) {
      return new Response(
        JSON.stringify({ partyId, role: roles[partyId] || null }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({ roles }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch roles' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as { partyId?: string; role?: string; requestingParty?: string };

    if (!body.partyId || !body.role) {
      return new Response(
        JSON.stringify({ success: false, error: 'partyId and role are required' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (body.role !== 'fund' && body.role !== 'primebroker' && body.role !== 'operator') {
      return new Response(
        JSON.stringify({ success: false, error: 'role must be "fund", "primebroker", or "operator"' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Authorization: operator (= custodian) can assign operator/primebroker, primebroker can assign fund
    const custodianParty = await env.PRIVAMARGIN_CONFIG.get('custodianParty');
    const rolesRaw = await env.PRIVAMARGIN_CONFIG.get('roles');
    const roles: Record<string, string> = rolesRaw ? JSON.parse(rolesRaw) : {};

    if (body.requestingParty) {
      const isOperator = body.requestingParty === custodianParty || roles[body.requestingParty] === 'operator';
      const requesterRole = roles[body.requestingParty];
      const isBroker = requesterRole === 'primebroker';

      if (body.role === 'operator' && !isOperator) {
        return new Response(
          JSON.stringify({ success: false, error: 'Only an operator can assign operator roles' }),
          { status: 403, headers: CORS_HEADERS }
        );
      }
      if (body.role === 'primebroker' && !isOperator) {
        return new Response(
          JSON.stringify({ success: false, error: 'Only the operator can assign prime broker roles' }),
          { status: 403, headers: CORS_HEADERS }
        );
      }
      if (body.role === 'fund' && !isOperator && !isBroker) {
        return new Response(
          JSON.stringify({ success: false, error: 'Only the operator or a prime broker can assign fund roles' }),
          { status: 403, headers: CORS_HEADERS }
        );
      }
    }

    roles[body.partyId] = body.role;
    await env.PRIVAMARGIN_CONFIG.put('roles', JSON.stringify(roles));

    return new Response(
      JSON.stringify({ success: true, partyId: body.partyId, role: body.role }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to assign role' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = await request.json() as { partyId?: string; requestingParty?: string };

    if (!body.partyId) {
      return new Response(
        JSON.stringify({ success: false, error: 'partyId is required' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Authorization: operator (= custodian) or prime broker can remove roles
    const custodianParty = await env.PRIVAMARGIN_CONFIG.get('custodianParty');
    const rolesRaw2 = await env.PRIVAMARGIN_CONFIG.get('roles');
    const currentRoles: Record<string, string> = rolesRaw2 ? JSON.parse(rolesRaw2) : {};

    if (body.requestingParty) {
      const isOperator = body.requestingParty === custodianParty || currentRoles[body.requestingParty] === 'operator';
      const requesterRole = currentRoles[body.requestingParty];
      const isBroker = requesterRole === 'primebroker';
      const targetRole = currentRoles[body.partyId];

      // Operator can remove anyone; broker can only remove funds
      if (!isOperator && !(isBroker && targetRole === 'fund')) {
        return new Response(
          JSON.stringify({ success: false, error: 'Insufficient permissions to remove this role' }),
          { status: 403, headers: CORS_HEADERS }
        );
      }
    }

    const rolesRaw = await env.PRIVAMARGIN_CONFIG.get('roles');
    const roles: Record<string, string> = rolesRaw ? JSON.parse(rolesRaw) : {};

    delete roles[body.partyId];
    await env.PRIVAMARGIN_CONFIG.put('roles', JSON.stringify(roles));

    return new Response(
      JSON.stringify({ success: true, partyId: body.partyId }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to remove role' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
