import { useState, useEffect } from 'react';

interface TokenIconProps {
  symbol: string;
  size?: number;
}

// Web3icons raw GitHub URL for branded token icons (same as cloudflare-wallet)
const WEB3ICONS_CDN = 'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/tokens/branded';

export default function TokenIcon({ symbol, size = 24 }: TokenIconProps) {
  const [iconSrc, setIconSrc] = useState<'web3' | 'local' | 'fallback'>('web3');
  const upperSymbol = symbol.toUpperCase();
  const lowerSymbol = symbol.toLowerCase();

  useEffect(() => {
    setIconSrc('web3');
  }, [symbol]);

  // Canton Coin — use local icon
  if (lowerSymbol === 'cc' || lowerSymbol === 'canton') {
    return (
      <img
        src="/tokens/canton.webp"
        alt="CC"
        width={size}
        height={size}
        style={{ borderRadius: '50%' }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }

  if (iconSrc === 'fallback') {
    return (
      <span
        style={{
          width: size,
          height: size,
          fontSize: size * 0.5,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.08)',
          color: 'rgba(255,255,255,0.4)',
          fontWeight: 700,
        }}
      >
        {upperSymbol.slice(0, 2)}
      </span>
    );
  }

  if (iconSrc === 'local') {
    return (
      <img
        src={`/tokens/${lowerSymbol}.webp`}
        alt={upperSymbol}
        width={size}
        height={size}
        style={{ borderRadius: '50%' }}
        onError={() => setIconSrc('fallback')}
      />
    );
  }

  return (
    <img
      src={`${WEB3ICONS_CDN}/${upperSymbol}.svg`}
      alt={upperSymbol}
      width={size}
      height={size}
      style={{ borderRadius: '50%' }}
      onError={() => setIconSrc('local')}
    />
  );
}
