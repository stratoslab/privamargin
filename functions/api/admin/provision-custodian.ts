/**
 * Provision Vault Custodian Party
 *
 * Creates a dedicated headless party ("vault-custodian") via the wallet admin API,
 * then stores its party ID in the PRIVAMARGIN_CONFIG KV store.
 *
 * The custodian party acts as the vault co-signatory and holds deposited CC/CUSD
 * tokens — analogous to an EVM vault contract address.
 *
 * After provisioning, the admin user is granted actAs/readAs rights for the
 * custodian party so the wallet SDK can submit multi-signatory commands.
 */

interface Env {
  PRIVAMARGIN_CONFIG: KVNamespace;
  WALLET_ADMIN_URL: string;
  CANTON_HOST: string;
  CANTON_AUTH_SECRET: string;
  CANTON_AUTH_USER: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

/**
 * Generate HS256 JWT for Canton JSON API authentication.
 * Same pattern as canton-json-client.ts in cloudflare-wallet.
 */
async function generateCantonToken(env: Env): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: env.CANTON_AUTH_USER,
    aud: 'https://canton.network.global',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  const encoder = new TextEncoder();
  const b64url = (data: Uint8Array) => btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const headerB64 = b64url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = b64url(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.CANTON_AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput))
  );

  return `${signingInput}.${b64url(signature)}`;
}

/**
 * Grant actAs/readAs rights to a user for a specific party.
 * Called after provisioning so the admin user can act on behalf of the custodian.
 */
async function grantCustodianRightsToAdmin(
  env: Env,
  adminUserId: string,
  custodianParty: string,
): Promise<void> {
  const token = await generateCantonToken(env);
  const url = `https://${env.CANTON_HOST}/v2/users/${adminUserId}/rights`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId: adminUserId,
      identityProviderId: '',
      rights: [
        { kind: { CanActAs: { value: { party: custodianParty } } } },
        { kind: { CanReadAs: { value: { party: custodianParty } } } },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Failed to grant custodian rights to admin: ${response.status} ${text}`);
    // Non-fatal — provisioning still succeeded
  } else {
    console.log(`Granted actAs/readAs rights for ${custodianParty} to admin user ${adminUserId}`);
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ env }) => {
  try {
    // Check if already provisioned
    const existing = await env.PRIVAMARGIN_CONFIG.get('custodianParty');
    if (existing) {
      return new Response(
        JSON.stringify({
          success: true,
          custodianParty: existing,
          message: 'Custodian already provisioned',
          alreadyExists: true,
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // Provision via wallet admin API
    const walletAdminUrl = env.WALLET_ADMIN_URL || 'https://wallet.cantondefi.com';
    const provisionUrl = `${walletAdminUrl}/api/admin/users`;

    console.log(`Provisioning vault-custodian via wallet admin API: ${provisionUrl}`);

    const provisionResponse = await fetch(provisionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'vault-custodian',
        displayName: 'Vault Custodian',
      }),
    });

    if (!provisionResponse.ok) {
      const errText = await provisionResponse.text();
      throw new Error(`Wallet admin API error: ${provisionResponse.status} ${errText}`);
    }

    const provisionResult = await provisionResponse.json() as {
      success: boolean;
      data?: { partyId: string; username: string };
    };

    if (!provisionResult.success || !provisionResult.data?.partyId) {
      throw new Error(`Wallet admin API returned no partyId: ${JSON.stringify(provisionResult)}`);
    }

    const custodianParty = provisionResult.data.partyId;
    console.log(`Vault custodian provisioned: ${custodianParty}`);

    // Store in KV
    await env.PRIVAMARGIN_CONFIG.put('custodianParty', custodianParty);

    // Grant admin user actAs/readAs rights for the custodian party
    // so the wallet SDK can submit multi-signatory commands (owner + custodian)
    if (env.CANTON_HOST && env.CANTON_AUTH_SECRET && env.CANTON_AUTH_USER) {
      try {
        await grantCustodianRightsToAdmin(env, env.CANTON_AUTH_USER, custodianParty);
      } catch (grantErr) {
        console.error('Failed to grant custodian rights to admin (non-fatal):', grantErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        custodianParty,
        message: 'Vault custodian provisioned successfully',
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error('Provision custodian failed:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : 'Failed to provision custodian',
      }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};

// GET: Check custodian status
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const custodianParty = await env.PRIVAMARGIN_CONFIG.get('custodianParty');
    return new Response(
      JSON.stringify({
        provisioned: !!custodianParty,
        custodianParty: custodianParty || null,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Failed to check custodian status' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
