/**
 * GET /api/devportal-role?party_id=...
 *
 * Returns the user's role from devportal. Used by the frontend to check
 * if the current user has the 'operator' role assigned in devportal admin.
 */

interface Env {
  PROXY_API_URL: string;
  PROXY_API_KEY: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const partyId = url.searchParams.get('party_id');

    if (!partyId) {
      return new Response(JSON.stringify({ error: 'party_id required' }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    if (!env.PROXY_API_URL || !env.PROXY_API_KEY) {
      return new Response(JSON.stringify({ role: 'user' }), {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    // Call devportal proxy to get user role
    const baseUrl = env.PROXY_API_URL.replace(/\/(query|exercise|create)$/, '');
    const res = await fetch(`${baseUrl}/user-role?party_id=${encodeURIComponent(partyId)}`, {
      headers: { 'X-API-Key': env.PROXY_API_KEY },
    });

    if (!res.ok) {
      console.error(`devportal-role: proxy returned ${res.status}`);
      return new Response(JSON.stringify({ role: 'user' }), {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    const data = await res.json() as { success: boolean; data?: { role: string } };
    return new Response(JSON.stringify({ role: data.data?.role || 'user' }), {
      status: 200,
      headers: CORS_HEADERS,
    });
  } catch (err) {
    console.error('devportal-role error:', err);
    return new Response(JSON.stringify({ role: 'user' }), {
      status: 200,
      headers: CORS_HEADERS,
    });
  }
};
