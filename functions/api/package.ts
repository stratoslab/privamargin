interface Env {
  PACKAGE_ID: string;
  PRIVAMARGIN_CONFIG: KVNamespace;
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

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  // Operator is derived from custodian party
  let operatorParty: string | null = null;
  try {
    operatorParty = await env.PRIVAMARGIN_CONFIG.get('custodianParty');
  } catch {
    // KV not configured or not available
  }

  return new Response(
    JSON.stringify({
      name: 'stratos-privamargin',
      packageId: env.PACKAGE_ID || null,
      operatorParty,
      darUrl: `${baseUrl}/package.dar`,
      templates: [
        'CollateralVault:CollateralVault',
        'Assets:TokenizedAsset',
        'Assets:AssetIssuance',
        'MarginVerification:MarginRequirement',
        'MarginVerification:MarginCall',
        'MarginVerification:Settlement',
        'MarginVerification:WorkflowMarginCall',
        'BrokerFundLink:BrokerFundInvitation',
        'BrokerFundLink:BrokerFundLink',
        'Position:Position',
      ],
    }),
    { status: 200, headers: CORS_HEADERS }
  );
};
