/**
 * Cloudflare Worker entry point for PrivaMargin.
 *
 * Replaces the Cloudflare Pages Functions routing with an explicit fetch handler
 * that maps URL paths to the existing function modules. Non-API routes are
 * forwarded to the static asset binding (SPA with fallback).
 */

import * as apiConfig from '../functions/api/config';
import * as apiPackage from '../functions/api/package';
import * as apiRoles from '../functions/api/roles';
import * as apiPrices from '../functions/api/prices';
import * as apiPositions from '../functions/api/positions';
import * as apiInvitations from '../functions/api/invitations';
import * as apiZkproof from '../functions/api/zkproof';
import * as apiAutoLiquidate from '../functions/api/auto-liquidate';
import * as adminBridgeOperator from '../functions/api/admin/bridge-operator';
import * as adminProvisionCustodian from '../functions/api/admin/provision-custodian';
import * as cantonSeizeCollateral from '../functions/api/canton/seize-collateral';
import * as custodianAcceptDeposit from '../functions/api/custodian/accept-deposit';
import * as custodianWithdraw from '../functions/api/custodian/withdraw';
import * as custodianWithdrawUsdc from '../functions/api/custodian/withdraw-usdc';
import * as escrowBalances from '../functions/api/escrow/balances';
import * as escrowConfig from '../functions/api/escrow/config';
import * as escrowDeploy from '../functions/api/escrow/deploy';
import * as swapCcToUsdc from '../functions/api/swap/cc-to-usdc';
import * as workflowConfig from '../functions/api/workflow/config';
import * as workflowHistory from '../functions/api/workflow/history';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Env {
  PRIVAMARGIN_CONFIG: KVNamespace;
  PACKAGE_ID: string;
  COINMARKETCAP_API_KEY: string;
  RPC_SEPOLIA: string;
  RPC_BASE_SEPOLIA: string;
  RPC_ETHEREUM: string;
  RPC_BASE: string;
  PROXY_API_URL: string;
  PROXY_API_KEY: string;
  CUSTODIAN_PARTY: string;
  USDC_TEMPLATE_ID: string;
  CC_TEMPLATE_ID: string;
  BRIDGE_OPERATOR_PARTY: string;
  DEPLOYER_PRIVATE_KEY: string;
  API_SECRET: string;
  ASSETS: Fetcher;
}

/**
 * Minimal context object that mirrors the PagesFunction signature so that the
 * existing handler exports can be called without modification.
 */
interface FunctionContext {
  request: Request;
  env: Env;
  params: Record<string, string>;
}

type Handler = (ctx: FunctionContext) => Response | Promise<Response>;

interface RouteHandlers {
  onRequestGet?: Handler;
  onRequestPost?: Handler;
  onRequestOptions?: Handler;
  onRequestDelete?: Handler;
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

const routes: Record<string, RouteHandlers> = {
  '/api/config': apiConfig as unknown as RouteHandlers,
  '/api/package': apiPackage as unknown as RouteHandlers,
  '/api/roles': apiRoles as unknown as RouteHandlers,
  '/api/prices': apiPrices as unknown as RouteHandlers,
  '/api/positions': apiPositions as unknown as RouteHandlers,
  '/api/invitations': apiInvitations as unknown as RouteHandlers,
  '/api/zkproof': apiZkproof as unknown as RouteHandlers,
  '/api/auto-liquidate': apiAutoLiquidate as unknown as RouteHandlers,
  '/api/admin/bridge-operator': adminBridgeOperator as unknown as RouteHandlers,
  '/api/admin/provision-custodian': adminProvisionCustodian as unknown as RouteHandlers,
  '/api/canton/seize-collateral': cantonSeizeCollateral as unknown as RouteHandlers,
  '/api/custodian/accept-deposit': custodianAcceptDeposit as unknown as RouteHandlers,
  '/api/custodian/withdraw': custodianWithdraw as unknown as RouteHandlers,
  '/api/custodian/withdraw-usdc': custodianWithdrawUsdc as unknown as RouteHandlers,
  '/api/escrow/balances': escrowBalances as unknown as RouteHandlers,
  '/api/escrow/config': escrowConfig as unknown as RouteHandlers,
  '/api/escrow/deploy': escrowDeploy as unknown as RouteHandlers,
  '/api/swap/cc-to-usdc': swapCcToUsdc as unknown as RouteHandlers,
  '/api/workflow/config': workflowConfig as unknown as RouteHandlers,
  '/api/workflow/history': workflowHistory as unknown as RouteHandlers,
};

// ---------------------------------------------------------------------------
// Method → handler name mapping
// ---------------------------------------------------------------------------

function handlerForMethod(method: string): keyof RouteHandlers | null {
  switch (method) {
    case 'GET':
      return 'onRequestGet';
    case 'POST':
      return 'onRequestPost';
    case 'OPTIONS':
      return 'onRequestOptions';
    case 'DELETE':
      return 'onRequestDelete';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Worker fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Look up route handlers for this path
    const handlers = routes[pathname];

    if (handlers) {
      const handlerName = handlerForMethod(request.method);

      if (handlerName && typeof handlers[handlerName] === 'function') {
        const ctx: FunctionContext = { request, env, params: {} };
        return handlers[handlerName]!(ctx);
      }

      // Method exists but no handler — return 405
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Non-API route — serve static assets (SPA fallback handled by asset binding config)
    return env.ASSETS.fetch(request);
  },
};
