/**
 * GET /api/escrow/balances?address=0x...&chainId=84532
 *
 * Reads on-chain balances (native ETH + USDC) for a given escrow address.
 * Used to detect external deposits that bypassed the Daml flow.
 *
 * Returns: { eth: string, usdc: string } (amounts in wei / smallest unit)
 */

interface Env {
  RPC_SEPOLIA: string;
  RPC_BASE_SEPOLIA: string;
  RPC_ETHEREUM: string;
  RPC_BASE: string;
}

// USDC contract addresses per chain
const USDC_ADDRESSES: Record<number, string> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

function getRpcUrl(env: Env, chainId: number): string | null {
  switch (chainId) {
    case 1: return env.RPC_ETHEREUM || 'https://ethereum-rpc.publicnode.com';
    case 11155111: return env.RPC_SEPOLIA || 'https://ethereum-sepolia-rpc.publicnode.com';
    case 8453: return env.RPC_BASE || 'https://base-rpc.publicnode.com';
    case 84532: return env.RPC_BASE_SEPOLIA || 'https://base-sepolia-rpc.publicnode.com';
    default: return null;
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json() as { result?: unknown; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const url = new URL(request.url);
  const address = url.searchParams.get('address');
  const chainId = parseInt(url.searchParams.get('chainId') || '0');

  if (!address || !chainId) {
    return jsonResponse({ error: 'Missing address or chainId' }, 400);
  }

  const rpcUrl = getRpcUrl(env, chainId);
  if (!rpcUrl) {
    return jsonResponse({ error: `Unsupported chainId: ${chainId}` }, 400);
  }

  try {
    // Get native ETH balance
    const ethBalanceHex = await rpcCall(rpcUrl, 'eth_getBalance', [address, 'latest']) as string;
    const ethBalance = BigInt(ethBalanceHex).toString();

    // Get USDC balance via balanceOf(address)
    let usdcBalance = '0';
    const usdcAddress = USDC_ADDRESSES[chainId];
    if (usdcAddress) {
      // balanceOf(address) selector: 0x70a08231 + padded address
      const paddedAddr = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');
      const usdcHex = await rpcCall(rpcUrl, 'eth_call', [
        { to: usdcAddress, data: paddedAddr },
        'latest',
      ]) as string;
      usdcBalance = BigInt(usdcHex || '0x0').toString();
    }

    return jsonResponse({
      address,
      chainId,
      eth: ethBalance,
      usdc: usdcBalance,
      // Human-readable (ETH has 18 decimals, USDC has 6)
      ethFormatted: (Number(ethBalance) / 1e18).toFixed(6),
      usdcFormatted: (Number(usdcBalance) / 1e6).toFixed(2),
    });
  } catch (error) {
    console.error('[escrow/balances] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Failed to read balances',
    }, 500);
  }
};
