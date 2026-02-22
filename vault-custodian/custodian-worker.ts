/**
 * PrivaMargin Vault Custodian Worker
 *
 * Cloudflare Worker that runs on a cron schedule to:
 * 1. Accept incoming Splice transfer offers sent to the custodian party
 * 2. Process vault withdrawals by creating return transfer offers
 *
 * The custodian party is a headless party that holds deposited CC/CUSD tokens.
 * It cannot unilaterally move tokens — only vault contract choices (WithdrawAsset)
 * trigger releases, which this worker detects and fulfils.
 */

interface Env {
  CANTON_HOST: string;
  CANTON_AUTH_SECRET: string;
  SPLICE_VALIDATOR_HOST: string;
  CUSTODIAN_PARTY: string;
  CUSTODIAN_USER: string;
  PACKAGE_ID: string;
}

// ============================================
// JWT AUTH (HS256 — same pattern as canton-json-client.ts)
// ============================================

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generateJWT(env: Env): Promise<string> {
  const encoder = new TextEncoder();
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: env.CUSTODIAN_USER,
    aud: 'https://canton.network.global',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  const headerB64 = base64url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64url(encoder.encode(JSON.stringify(payload)));
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

  return `${signingInput}.${base64url(signature)}`;
}

// ============================================
// CANTON JSON API v2 HELPERS
// ============================================

async function cantonQuery(
  env: Env,
  templateId: string,
  filter?: Record<string, unknown>
): Promise<any[]> {
  const token = await generateJWT(env);

  // Get ledger end offset first
  const offsetRes = await fetch(`https://${env.CANTON_HOST}/v2/state/ledger-end`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!offsetRes.ok) {
    console.error('Failed to get ledger end:', await offsetRes.text());
    return [];
  }
  const { offset } = await offsetRes.json() as { offset: number };

  // Query active contracts
  const queryBody = {
    filter: {
      filtersByParty: {
        [env.CUSTODIAN_PARTY]: {
          cumulative: [{
            identifierFilter: {
              TemplateFilter: {
                value: { templateId, includeCreatedEventBlob: false }
              }
            }
          }]
        }
      }
    },
    verbose: true,
    activeAtOffset: offset,
  };

  const res = await fetch(`https://${env.CANTON_HOST}/v2/state/active-contracts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(queryBody),
  });

  if (!res.ok) {
    console.error('Canton query failed:', await res.text());
    return [];
  }

  const results = await res.json() as Array<{
    contractEntry: {
      JsActiveContract: {
        createdEvent: {
          contractId: string;
          templateId: string;
          createArgument: Record<string, unknown>;
        };
      };
    };
  }>;

  let contracts = (results || []).map(c => ({
    contractId: c.contractEntry.JsActiveContract.createdEvent.contractId,
    payload: c.contractEntry.JsActiveContract.createdEvent.createArgument,
  }));

  // Client-side filtering
  if (filter) {
    contracts = contracts.filter(c =>
      Object.entries(filter).every(([k, v]) => c.payload[k] === v)
    );
  }

  return contracts;
}

// ============================================
// SPLICE VALIDATOR API HELPERS
// ============================================

async function spliceListOffers(env: Env): Promise<any[]> {
  const token = await generateJWT(env);
  const url = `https://${env.SPLICE_VALIDATOR_HOST}/api/validator/v0/wallet/transfer-offers`;

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Splice list offers failed: ${res.status} ${text}`);
    return [];
  }

  const data = await res.json() as { offers?: any[]; transfer_offers?: any[] };
  return data.offers || data.transfer_offers || [];
}

async function spliceAcceptOffer(env: Env, offerId: string): Promise<boolean> {
  const token = await generateJWT(env);
  const url = `https://${env.SPLICE_VALIDATOR_HOST}/api/validator/v0/wallet/transfer-offers/${offerId}/accept`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Splice accept offer failed: ${res.status} ${text}`);
    return false;
  }

  return true;
}

async function spliceCreateTransferOffer(
  env: Env,
  receiver: string,
  amount: string,
): Promise<boolean> {
  const token = await generateJWT(env);
  const url = `https://${env.SPLICE_VALIDATOR_HOST}/api/validator/v0/wallet/transfer-offers`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      receiver_party_id: receiver,
      amount,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Splice create transfer offer failed: ${res.status} ${text}`);
    return false;
  }

  return true;
}

// ============================================
// MAIN JOBS
// ============================================

/**
 * Job 1: Accept incoming transfer offers
 * Scans for pending offers directed to the custodian and accepts them all.
 */
async function acceptTransferOffers(env: Env): Promise<number> {
  const offers = await spliceListOffers(env);
  let accepted = 0;

  for (const offer of offers) {
    const offerId = offer.contract_id || offer.offer_contract_id || offer.id;
    if (!offerId) {
      console.warn('Offer missing ID, skipping:', JSON.stringify(offer).slice(0, 200));
      continue;
    }

    console.log(`Accepting transfer offer: ${offerId}`);
    const success = await spliceAcceptOffer(env, offerId);
    if (success) {
      accepted++;
      console.log(`Accepted offer ${offerId}`);
    }
  }

  return accepted;
}

/**
 * Job 2: Process withdrawals
 * Checks for vault contracts where a WithdrawAsset was exercised.
 * When the vault's collateral has decreased (withdrawal detected), create a
 * return transfer offer from custodian to the vault owner.
 *
 * Note: In the current design, the Daml WithdrawAsset choice archives/recreates
 * the vault contract. A more robust approach would use the Canton updates stream
 * to detect exercise events. For now, we rely on the frontend or a separate
 * mechanism to signal withdrawals.
 */
async function processWithdrawals(env: Env): Promise<number> {
  const VAULT_TEMPLATE = `${env.PACKAGE_ID}:CollateralVault:CollateralVault`;

  // Query all vault contracts where custodian is operator
  const vaults = await cantonQuery(env, VAULT_TEMPLATE, { operator: env.CUSTODIAN_PARTY });
  console.log(`Found ${vaults.length} vaults managed by custodian`);

  // For now, just log — withdrawal detection requires either:
  // 1. Polling the Canton updates/transactions stream for WithdrawAsset exercises
  // 2. A webhook/signal from the frontend when a withdrawal is exercised
  // This will be implemented in a future iteration with the updates endpoint
  return 0;
}

// ============================================
// WORKER ENTRYPOINT
// ============================================

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    console.log('Vault Custodian Worker: cron triggered');

    if (!env.CUSTODIAN_PARTY || !env.CUSTODIAN_USER) {
      console.log('Custodian not configured, skipping');
      return;
    }

    try {
      const accepted = await acceptTransferOffers(env);
      const withdrawals = await processWithdrawals(env);

      console.log(`Custodian Worker complete: ${accepted} offers accepted, ${withdrawals} withdrawals processed`);
    } catch (err) {
      console.error('Custodian Worker error:', err);
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === '/run' && request.method === 'POST') {
      if (!env.CUSTODIAN_PARTY || !env.CUSTODIAN_USER) {
        return Response.json({ error: 'Custodian not configured' }, { status: 400 });
      }

      const accepted = await acceptTransferOffers(env);
      const withdrawals = await processWithdrawals(env);

      return Response.json({
        success: true,
        offersAccepted: accepted,
        withdrawalsProcessed: withdrawals,
      });
    }

    if (url.pathname === '/status') {
      return Response.json({
        custodianParty: env.CUSTODIAN_PARTY || null,
        custodianUser: env.CUSTODIAN_USER || null,
        configured: !!(env.CUSTODIAN_PARTY && env.CUSTODIAN_USER),
      });
    }

    return Response.json({
      name: 'privamargin-vault-custodian',
      endpoints: {
        '/run': 'POST - Run custodian jobs (accept offers, process withdrawals)',
        '/status': 'GET - Check custodian configuration status',
      },
    });
  },
};
