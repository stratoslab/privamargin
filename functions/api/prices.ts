interface Env {
  COINMARKETCAP_API_KEY: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
};

// CoinMarketCap IDs for each asset
const CMC_IDS: Record<string, number> = {
  CC: 37263,    // Canton Network
  BTC: 1,
  ETH: 1027,
  SOL: 5426,
  USDC: 3408,
  USDT: 825,
  TRX: 1958,
  TON: 11419,
};

const FALLBACK_PRICES: Record<string, number> = {
  CC: 0.158,
  CUSD: 1.0,
  USDC: 1.0,
  USDT: 1.0,
  BTC: 95000,
  ETH: 3500,
  SOL: 180,
  TRX: 0.25,
  TON: 5.50,
};

// Asset metadata for display
const ASSET_METADATA = [
  { symbol: 'CC', name: 'Canton Coin', description: 'Native Canton Network token', logo: 'https://n1.cantondefi.com/tokens/canton.webp' },
  { symbol: 'CUSD', name: 'CUSD', description: 'USD-pegged by Brale', logo: 'https://pbs.twimg.com/profile_images/1985781052976271360/M22L1CAz_400x400.jpg' },
  { symbol: 'USDC', name: 'USDC', description: 'USD Coin', logo: 'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/tokens/branded/USDC.svg' },
  { symbol: 'USDT', name: 'USDT', description: 'Tether USD', logo: 'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/tokens/branded/USDT.svg' },
  { symbol: 'BTC', name: 'BTC', description: 'Bitcoin', logo: 'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/tokens/branded/BTC.svg' },
  { symbol: 'ETH', name: 'ETH', description: 'Ethereum', logo: 'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/tokens/branded/ETH.svg' },
  { symbol: 'SOL', name: 'SOL', description: 'Solana', logo: 'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/tokens/branded/SOL.svg' },
  { symbol: 'TRX', name: 'TRX', description: 'Tron', logo: 'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/tokens/branded/TRX.svg' },
  { symbol: 'TON', name: 'TON', description: 'Toncoin', logo: 'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/tokens/branded/TON.svg' },
];

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  let prices = { ...FALLBACK_PRICES };
  let source = 'fallback';

  // Try to fetch live prices from CoinMarketCap
  if (env.COINMARKETCAP_API_KEY) {
    try {
      const ids = Object.values(CMC_IDS).join(',');
      const response = await fetch(
        `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=${ids}`,
        {
          headers: {
            'X-CMC_PRO_API_KEY': env.COINMARKETCAP_API_KEY,
            'Accept': 'application/json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json() as {
          data?: Record<string, { quote?: { USD?: { price?: number } } }>
        };

        if (data.data) {
          for (const [symbol, cmcId] of Object.entries(CMC_IDS)) {
            const assetData = data.data[cmcId.toString()];
            if (assetData?.quote?.USD?.price) {
              prices[symbol] = assetData.quote.USD.price;
            }
          }
          source = 'coinmarketcap';
        }
      }
    } catch (err) {
      console.error('Failed to fetch prices from CoinMarketCap:', err);
    }
  }

  // Build assets array with prices and metadata
  const assets = ASSET_METADATA.map(asset => ({
    ...asset,
    price: prices[asset.symbol] || 0,
  }));

  return new Response(
    JSON.stringify({
      prices,
      assets,
      timestamp: new Date().toISOString(),
      source
    }),
    { headers: CORS_HEADERS }
  );
};
