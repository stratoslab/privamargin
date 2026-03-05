import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Container,
} from '@mui/material';
import {
  VerifiedUser,
  AccountBalance,
  TrendingUp,
  Description,
  Lock,
  Shield,
  ArrowForward,
  KeyboardArrowDown,
  Hub,
  Visibility,
  Fingerprint,
} from '@mui/icons-material';

// ── App URL — points to the main Cloudflare Pages deployment ───────────
const APP_URL = 'https://portal.stratoslab.xyz/?code=525ZVB8D';

// ── Palette ────────────────────────────────────────────────────────────
const TEAL = '#00d4aa';
const PURPLE = '#8b5cf6';
const AMBER = '#f59e0b';
const BG = '#0a0e14';
const CARD = '#111820';
const BORDER = 'rgba(255,255,255,0.06)';

// ── Web3Icons CDN (same pattern as TokenIcon.tsx) ──────────────────────
const WEB3_CDN =
  'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/tokens/branded';

// ── Intersection-observer fade-in hook ─────────────────────────────────
function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
          obs.unobserve(el);
        }
      },
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

// ── Proof-hash ticker ──────────────────────────────────────────────────
function ProofTicker() {
  const [hashes, setHashes] = useState<string[]>([]);

  useEffect(() => {
    const gen = () =>
      '0x' +
      Array.from({ length: 16 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join('');
    const initial = Array.from({ length: 24 }, gen);
    setHashes(initial);
    const id = setInterval(() => {
      setHashes((prev) => [...prev.slice(1), gen()]);
    }, 600);
    return () => clearInterval(id);
  }, []);

  return (
    <Box
      sx={{
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        py: 1.5,
        opacity: 0.35,
        maskImage:
          'linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%)',
      }}
    >
      <Box
        sx={{
          display: 'inline-flex',
          gap: 4,
          animation: 'ticker 40s linear infinite',
          '@keyframes ticker': {
            '0%': { transform: 'translateX(0)' },
            '100%': { transform: 'translateX(-50%)' },
          },
        }}
      >
        {hashes.concat(hashes).map((h, i) => (
          <Typography
            key={i}
            component="span"
            sx={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 13,
              color: TEAL,
              letterSpacing: '0.5px',
            }}
          >
            {h}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

// ── Smooth scroll helper ───────────────────────────────────────────────
function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

// ── Section wrapper with fade-in ───────────────────────────────────────
function Section({
  id,
  children,
  sx,
}: {
  id?: string;
  children: React.ReactNode;
  sx?: object;
}) {
  const ref = useFadeIn();
  return (
    <Box
      id={id}
      ref={ref}
      sx={{
        py: { xs: 8, md: 12 },
        opacity: 0,
        transform: 'translateY(32px)',
        transition: 'opacity 0.7s ease, transform 0.7s ease',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

// ── Features data ──────────────────────────────────────────────────────
const features = [
  {
    icon: VerifiedUser,
    color: TEAL,
    title: 'ZK-Verified Collateral',
    desc: 'Groth16 proofs verify margin sufficiency without revealing portfolio composition or exact balances.',
  },
  {
    icon: AccountBalance,
    color: PURPLE,
    title: 'Multi-Chain Collateral',
    desc: 'Deposit from Ethereum, Base, Solana, and more. Unified collateral view across all supported chains.',
  },
  {
    icon: TrendingUp,
    color: AMBER,
    title: 'Real-Time LTV Monitoring',
    desc: 'Continuous loan-to-value tracking with automated alerts and liquidation thresholds.',
  },
  {
    icon: Description,
    color: TEAL,
    title: 'Daml Smart Contracts',
    desc: 'Business logic encoded in Daml on Canton Network for deterministic, auditable execution.',
  },
  {
    icon: Lock,
    color: PURPLE,
    title: 'On-Chain Escrow',
    desc: 'EVM escrow contracts hold collateral with smart-contract-enforced release conditions.',
  },
  {
    icon: Shield,
    color: AMBER,
    title: 'Institutional Grade',
    desc: 'Built for funds and prime brokers. Role-based access, audit trails, and regulatory compliance.',
  },
];

// ── How It Works steps ─────────────────────────────────────────────────
const steps = [
  {
    num: '01',
    title: 'Deposit Collateral',
    desc: 'Fund deposits multi-chain assets into EVM escrow contracts.',
  },
  {
    num: '02',
    title: 'Open Positions',
    desc: 'Primebroker extends margin against verified collateral.',
  },
  {
    num: '03',
    title: 'ZK Verification',
    desc: 'Groth16 proofs attest sufficient collateral without revealing balances.',
  },
  {
    num: '04',
    title: 'Automated Protection',
    desc: 'Operator monitors LTV and triggers liquidation when thresholds breach.',
  },
];

// ── Supported chains ───────────────────────────────────────────────────
const chains = [
  { name: 'Canton', status: 'Native', color: TEAL },
  { name: 'Ethereum', status: 'Live', color: PURPLE },
  { name: 'Base', status: 'Live', color: '#2563eb' },
  { name: 'Solana', status: 'Coming Soon', color: 'rgba(255,255,255,0.35)' },
  { name: 'Tron', status: 'Coming Soon', color: 'rgba(255,255,255,0.35)' },
  { name: 'TON', status: 'Coming Soon', color: 'rgba(255,255,255,0.35)' },
];

const tokens = [
  { symbol: 'BTC', label: 'Bitcoin' },
  { symbol: 'ETH', label: 'Ethereum' },
  { symbol: 'USDC', label: 'USDC' },
  { symbol: 'SOL', label: 'Solana' },
  { symbol: 'CC', label: 'Canton Coin' },
];

// ════════════════════════════════════════════════════════════════════════
// Landing Page
// ════════════════════════════════════════════════════════════════════════
export default function Landing() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <Box sx={{ bgcolor: BG, color: 'white', minHeight: '100vh', overflowX: 'hidden' }}>
      {/* ─── Sticky Nav ─────────────────────────────────────────────── */}
      <Box
        component="nav"
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1100,
          px: { xs: 2, md: 4 },
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backdropFilter: scrolled ? 'blur(16px)' : 'none',
          bgcolor: scrolled ? 'rgba(10,14,20,0.85)' : 'transparent',
          borderBottom: scrolled ? `1px solid ${BORDER}` : '1px solid transparent',
          transition: 'all 0.3s ease',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <img src="/favicon.png" alt="PrivaMargin" width={32} height={32} style={{ borderRadius: '8px' }} />
          <Typography
            sx={{
              fontWeight: 600,
              fontSize: 18,
              fontFamily: '"Outfit", sans-serif',
              letterSpacing: '-0.3px',
            }}
          >
            Priva<span style={{ color: TEAL }}>Margin</span>
          </Typography>
        </Box>

        <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 3, alignItems: 'center' }}>
          {['Features', 'How It Works'].map((label) => (
            <Typography
              key={label}
              onClick={() => scrollTo(label.toLowerCase().replace(/\s+/g, '-'))}
              sx={{
                fontSize: 14,
                color: 'rgba(255,255,255,0.6)',
                cursor: 'pointer',
                fontFamily: '"Outfit", sans-serif',
                '&:hover': { color: 'white' },
                transition: 'color 0.2s',
              }}
            >
              {label}
            </Typography>
          ))}
          <Button
            href={APP_URL}
            sx={{
              bgcolor: TEAL,
              color: BG,
              fontWeight: 600,
              textTransform: 'none',
              px: 2.5,
              py: 0.8,
              borderRadius: '8px',
              fontSize: 14,
              fontFamily: '"Outfit", sans-serif',
              '&:hover': { bgcolor: '#00c49a' },
            }}
          >
            Launch App
          </Button>
        </Box>
      </Box>

      {/* ─── Hero ───────────────────────────────────────────────────── */}
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          position: 'relative',
          px: 2,
          pt: 8,
          background: `radial-gradient(ellipse at 30% 20%, rgba(139,92,246,0.15) 0%, transparent 50%),
                        radial-gradient(ellipse at 70% 60%, rgba(0,212,170,0.1) 0%, transparent 50%),
                        ${BG}`,
        }}
      >
        <Box
          sx={{
            px: 2,
            py: 0.6,
            bgcolor: 'rgba(139,92,246,0.15)',
            borderRadius: '20px',
            border: '1px solid rgba(139,92,246,0.3)',
            mb: 3,
          }}
        >
          <Typography
            sx={{
              fontSize: 13,
              color: PURPLE,
              fontWeight: 500,
              fontFamily: '"Outfit", sans-serif',
            }}
          >
            Built on Canton Network
          </Typography>
        </Box>

        <Typography
          sx={{
            fontSize: { xs: 36, md: 56 },
            fontWeight: 700,
            lineHeight: 1.1,
            maxWidth: 800,
            mb: 3,
            fontFamily: '"Outfit", sans-serif',
            letterSpacing: '-1px',
          }}
        >
          Privacy-Preserving{' '}
          <span style={{ color: TEAL }}>Collateral Management</span>
        </Typography>

        <Typography
          sx={{
            fontSize: { xs: 16, md: 18 },
            color: 'rgba(255,255,255,0.6)',
            maxWidth: 600,
            mb: 5,
            lineHeight: 1.6,
            fontFamily: '"Outfit", sans-serif',
          }}
        >
          Zero-knowledge proofs verify margin sufficiency without exposing
          portfolio details. Your collateral stays private, your compliance
          stays provable.
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, mb: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button
            href={APP_URL}
            sx={{
              bgcolor: TEAL,
              color: BG,
              fontWeight: 600,
              textTransform: 'none',
              px: 4,
              py: 1.5,
              borderRadius: '10px',
              fontSize: 16,
              fontFamily: '"Outfit", sans-serif',
              '&:hover': { bgcolor: '#00c49a' },
            }}
          >
            Launch App <ArrowForward sx={{ ml: 1, fontSize: 18 }} />
          </Button>
          <Button
            onClick={() => scrollTo('architecture')}
            variant="outlined"
            sx={{
              borderColor: 'rgba(255,255,255,0.2)',
              color: 'white',
              fontWeight: 500,
              textTransform: 'none',
              px: 4,
              py: 1.5,
              borderRadius: '10px',
              fontSize: 16,
              fontFamily: '"Outfit", sans-serif',
              '&:hover': { borderColor: 'rgba(255,255,255,0.4)', bgcolor: 'rgba(255,255,255,0.04)' },
            }}
          >
            View Architecture
          </Button>
        </Box>

        <ProofTicker />

        <Box
          onClick={() => scrollTo('features')}
          sx={{
            position: 'absolute',
            bottom: 32,
            cursor: 'pointer',
            animation: 'bounce 2s infinite',
            '@keyframes bounce': {
              '0%, 100%': { transform: 'translateY(0)' },
              '50%': { transform: 'translateY(8px)' },
            },
          }}
        >
          <KeyboardArrowDown sx={{ fontSize: 32, color: 'rgba(255,255,255,0.3)' }} />
        </Box>
      </Box>

      {/* ─── Demo Video ────────────────────────────────────────────── */}
      <Section id="demo">
        <Container maxWidth="md">
          <Typography
            sx={{
              fontSize: { xs: 28, md: 40 },
              fontWeight: 700,
              textAlign: 'center',
              mb: 2,
              fontFamily: '"Outfit", sans-serif',
              letterSpacing: '-0.5px',
            }}
          >
            See It In <span style={{ color: TEAL }}>Action</span>
          </Typography>
          <Typography
            sx={{
              fontSize: 16,
              color: 'rgba(255,255,255,0.5)',
              textAlign: 'center',
              maxWidth: 480,
              mx: 'auto',
              mb: 5,
              fontFamily: '"Outfit", sans-serif',
            }}
          >
            Watch how PrivaMargin handles deposits, margin verification, and
            liquidation protection end-to-end.
          </Typography>
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              paddingTop: '56.25%', // 16:9
              borderRadius: '16px',
              overflow: 'hidden',
              border: `1px solid ${BORDER}`,
              bgcolor: CARD,
            }}
          >
            <iframe
              src="https://www.youtube.com/embed/Q_IqZhUsV_U"
              title="PrivaMargin Demo"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                border: 'none',
              }}
            />
          </Box>
        </Container>
      </Section>

      {/* ─── Features ───────────────────────────────────────────────── */}
      <Section id="features">
        <Container maxWidth="lg">
          <Typography
            sx={{
              fontSize: { xs: 28, md: 40 },
              fontWeight: 700,
              textAlign: 'center',
              mb: 2,
              fontFamily: '"Outfit", sans-serif',
              letterSpacing: '-0.5px',
            }}
          >
            Core <span style={{ color: TEAL }}>Features</span>
          </Typography>
          <Typography
            sx={{
              fontSize: 16,
              color: 'rgba(255,255,255,0.5)',
              textAlign: 'center',
              maxWidth: 540,
              mx: 'auto',
              mb: 6,
              fontFamily: '"Outfit", sans-serif',
            }}
          >
            Enterprise-grade collateral management with zero-knowledge privacy
            and multi-chain support.
          </Typography>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
              gap: 3,
            }}
          >
            {features.map((f) => (
              <Box
                key={f.title}
                sx={{
                  bgcolor: CARD,
                  borderRadius: '16px',
                  border: `1px solid ${BORDER}`,
                  p: 3.5,
                  transition: 'border-color 0.3s, transform 0.3s',
                  '&:hover': {
                    borderColor: `${f.color}40`,
                    transform: 'translateY(-4px)',
                  },
                }}
              >
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: '12px',
                    bgcolor: `${f.color}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mb: 2,
                  }}
                >
                  <f.icon sx={{ color: f.color, fontSize: 22 }} />
                </Box>
                <Typography
                  sx={{
                    fontSize: 17,
                    fontWeight: 600,
                    mb: 1,
                    fontFamily: '"Outfit", sans-serif',
                  }}
                >
                  {f.title}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 14,
                    color: 'rgba(255,255,255,0.5)',
                    lineHeight: 1.6,
                    fontFamily: '"Outfit", sans-serif',
                  }}
                >
                  {f.desc}
                </Typography>
              </Box>
            ))}
          </Box>
        </Container>
      </Section>

      {/* ─── How It Works ───────────────────────────────────────────── */}
      <Section id="how-it-works" sx={{ bgcolor: 'rgba(255,255,255,0.015)' }}>
        <Container maxWidth="lg">
          <Typography
            sx={{
              fontSize: { xs: 28, md: 40 },
              fontWeight: 700,
              textAlign: 'center',
              mb: 2,
              fontFamily: '"Outfit", sans-serif',
              letterSpacing: '-0.5px',
            }}
          >
            How It <span style={{ color: PURPLE }}>Works</span>
          </Typography>
          <Typography
            sx={{
              fontSize: 16,
              color: 'rgba(255,255,255,0.5)',
              textAlign: 'center',
              maxWidth: 500,
              mx: 'auto',
              mb: 8,
              fontFamily: '"Outfit", sans-serif',
            }}
          >
            From deposit to protection in four steps.
          </Typography>

          {/* Desktop: horizontal with connecting lines */}
          <Box
            sx={{
              display: { xs: 'none', md: 'grid' },
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 3,
              position: 'relative',
            }}
          >
            {/* Connecting line */}
            <Box
              sx={{
                position: 'absolute',
                top: 36,
                left: 'calc(12.5% + 24px)',
                right: 'calc(12.5% + 24px)',
                height: 2,
                bgcolor: BORDER,
                zIndex: 0,
              }}
            />
            {steps.map((s) => (
              <Box
                key={s.num}
                sx={{ textAlign: 'center', position: 'relative', zIndex: 1 }}
              >
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    bgcolor: CARD,
                    border: `2px solid ${PURPLE}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mx: 'auto',
                    mb: 2,
                  }}
                >
                  <Typography
                    sx={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 14,
                      fontWeight: 700,
                      color: PURPLE,
                    }}
                  >
                    {s.num}
                  </Typography>
                </Box>
                <Typography
                  sx={{
                    fontSize: 16,
                    fontWeight: 600,
                    mb: 1,
                    fontFamily: '"Outfit", sans-serif',
                  }}
                >
                  {s.title}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 14,
                    color: 'rgba(255,255,255,0.5)',
                    lineHeight: 1.5,
                    fontFamily: '"Outfit", sans-serif',
                  }}
                >
                  {s.desc}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Mobile: vertical with connecting line */}
          <Box sx={{ display: { xs: 'block', md: 'none' }, position: 'relative', pl: 5 }}>
            {/* Vertical line */}
            <Box
              sx={{
                position: 'absolute',
                left: 23,
                top: 24,
                bottom: 24,
                width: 2,
                bgcolor: BORDER,
              }}
            />
            {steps.map((s, i) => (
              <Box key={s.num} sx={{ position: 'relative', mb: i < steps.length - 1 ? 5 : 0 }}>
                <Box
                  sx={{
                    position: 'absolute',
                    left: -28,
                    top: 0,
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    bgcolor: CARD,
                    border: `2px solid ${PURPLE}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Typography
                    sx={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 14,
                      fontWeight: 700,
                      color: PURPLE,
                    }}
                  >
                    {s.num}
                  </Typography>
                </Box>
                <Box sx={{ pt: 0.5 }}>
                  <Typography
                    sx={{
                      fontSize: 16,
                      fontWeight: 600,
                      mb: 0.5,
                      fontFamily: '"Outfit", sans-serif',
                    }}
                  >
                    {s.title}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: 14,
                      color: 'rgba(255,255,255,0.5)',
                      lineHeight: 1.5,
                      fontFamily: '"Outfit", sans-serif',
                    }}
                  >
                    {s.desc}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </Container>
      </Section>

      {/* ─── Chainlink Runtime Environment ─────────────────────────── */}
      <Section id="architecture">
        <Container maxWidth="lg">
          <Typography
            sx={{
              fontSize: { xs: 28, md: 40 },
              fontWeight: 700,
              textAlign: 'center',
              mb: 2,
              fontFamily: '"Outfit", sans-serif',
              letterSpacing: '-0.5px',
            }}
          >
            Chainlink <span style={{ color: AMBER }}>Runtime Environment</span>
          </Typography>
          <Typography
            sx={{
              fontSize: 16,
              color: 'rgba(255,255,255,0.5)',
              textAlign: 'center',
              maxWidth: 600,
              mx: 'auto',
              mb: 8,
              fontFamily: '"Outfit", sans-serif',
              lineHeight: 1.7,
            }}
          >
            The Chainlink Runtime Environment operates the LTV monitor — retrieving
            active positions from PrivaMargin via the Canton Network ledger API,
            then fetching oracle prices through the Chainlink Decentralized Oracle
            Network.
          </Typography>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' },
              gap: 3,
              mb: 6,
            }}
          >
            {[
              {
                icon: Hub,
                color: AMBER,
                title: 'Oracle-Powered LTV',
                desc: 'Calculates the loan-to-value ratio for each position using real-time prices from CoinGecko and other data providers through the Chainlink Decentralized Oracle Network.',
              },
              {
                icon: Fingerprint,
                color: PURPLE,
                title: 'Verifiable Proofs',
                desc: 'Every LTV calculation generates a verifiable proof. Updated values and their corresponding proofs are written back to the Canton Network via its API.',
              },
              {
                icon: Visibility,
                color: TEAL,
                title: 'Transparent & Tamper-Evident',
                desc: 'Even if individual HTTP endpoints are compromised, the on-ledger records and oracle proofs allow any discrepancies or operational lapses to be traced and audited with confidence.',
              },
            ].map((item) => (
              <Box
                key={item.title}
                sx={{
                  bgcolor: CARD,
                  borderRadius: '16px',
                  border: `1px solid ${BORDER}`,
                  p: 3.5,
                  transition: 'border-color 0.3s, transform 0.3s',
                  '&:hover': {
                    borderColor: `${item.color}40`,
                    transform: 'translateY(-4px)',
                  },
                }}
              >
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: '12px',
                    bgcolor: `${item.color}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mb: 2,
                  }}
                >
                  <item.icon sx={{ color: item.color, fontSize: 22 }} />
                </Box>
                <Typography
                  sx={{
                    fontSize: 17,
                    fontWeight: 600,
                    mb: 1,
                    fontFamily: '"Outfit", sans-serif',
                  }}
                >
                  {item.title}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 14,
                    color: 'rgba(255,255,255,0.5)',
                    lineHeight: 1.6,
                    fontFamily: '"Outfit", sans-serif',
                  }}
                >
                  {item.desc}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Architecture flow diagram */}
          <Box
            sx={{
              bgcolor: CARD,
              borderRadius: '16px',
              border: `1px solid ${BORDER}`,
              p: { xs: 3, md: 4 },
            }}
          >
            <Typography
              sx={{
                fontSize: 15,
                fontWeight: 600,
                mb: 3,
                fontFamily: '"Outfit", sans-serif',
                color: AMBER,
                textAlign: 'center',
              }}
            >
              End-to-End Flow
            </Typography>
            <Box
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                alignItems: 'center',
                justifyContent: 'center',
                gap: { xs: 1, md: 0 },
              }}
            >
              {[
                'Canton Ledger API',
                'Retrieve Positions',
                'Chainlink DON',
                'Fetch Oracle Prices',
                'Compute LTV + Proof',
                'Write Back to Canton',
              ].map((label, i, arr) => (
                <Box
                  key={label}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: { xs: 1, md: 0 },
                    flexDirection: { xs: 'column', md: 'row' },
                  }}
                >
                  <Box
                    sx={{
                      px: 2,
                      py: 1,
                      bgcolor: 'rgba(255,255,255,0.04)',
                      borderRadius: '8px',
                      border: `1px solid ${BORDER}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: 12,
                        fontFamily: '"JetBrains Mono", monospace',
                        color: i % 2 === 0 ? TEAL : 'rgba(255,255,255,0.6)',
                        fontWeight: 500,
                      }}
                    >
                      {label}
                    </Typography>
                  </Box>
                  {i < arr.length - 1 && (
                    <ArrowForward
                      sx={{
                        fontSize: 16,
                        color: 'rgba(255,255,255,0.2)',
                        mx: 1,
                        transform: { xs: 'rotate(90deg)', md: 'none' },
                      }}
                    />
                  )}
                </Box>
              ))}
            </Box>
          </Box>
        </Container>
      </Section>

      {/* ─── Supported Chains ───────────────────────────────────────── */}
      <Section sx={{ bgcolor: 'rgba(255,255,255,0.015)' }}>
        <Container maxWidth="lg">
          <Typography
            sx={{
              fontSize: { xs: 28, md: 40 },
              fontWeight: 700,
              textAlign: 'center',
              mb: 2,
              fontFamily: '"Outfit", sans-serif',
              letterSpacing: '-0.5px',
            }}
          >
            Supported <span style={{ color: TEAL }}>Chains</span>
          </Typography>
          <Typography
            sx={{
              fontSize: 16,
              color: 'rgba(255,255,255,0.5)',
              textAlign: 'center',
              maxWidth: 460,
              mx: 'auto',
              mb: 6,
              fontFamily: '"Outfit", sans-serif',
            }}
          >
            Unified collateral across multiple networks.
          </Typography>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr 1fr',
                sm: 'repeat(3, 1fr)',
                md: 'repeat(6, 1fr)',
              },
              gap: 2,
              mb: 6,
            }}
          >
            {chains.map((c) => (
              <Box
                key={c.name}
                sx={{
                  bgcolor: CARD,
                  borderRadius: '12px',
                  border: `1px solid ${BORDER}`,
                  p: 2.5,
                  textAlign: 'center',
                }}
              >
                <Typography
                  sx={{
                    fontSize: 15,
                    fontWeight: 600,
                    mb: 0.5,
                    fontFamily: '"Outfit", sans-serif',
                    color: c.color,
                  }}
                >
                  {c.name}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 11,
                    color: c.status === 'Coming Soon' ? 'rgba(255,255,255,0.3)' : TEAL,
                    fontWeight: 500,
                    fontFamily: '"Outfit", sans-serif',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  {c.status}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Token icons row */}
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              gap: 3,
              flexWrap: 'wrap',
            }}
          >
            {tokens.map((t) => (
              <Box
                key={t.symbol}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 2,
                  py: 1,
                  bgcolor: 'rgba(255,255,255,0.03)',
                  borderRadius: '10px',
                  border: `1px solid ${BORDER}`,
                }}
              >
                {t.symbol === 'CC' ? (
                  <img
                    src="/tokens/canton.webp"
                    alt="CC"
                    width={24}
                    height={24}
                    style={{ borderRadius: '50%' }}
                  />
                ) : (
                  <img
                    src={`${WEB3_CDN}/${t.symbol}.svg`}
                    alt={t.symbol}
                    width={24}
                    height={24}
                    style={{ borderRadius: '50%' }}
                  />
                )}
                <Typography
                  sx={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'rgba(255,255,255,0.7)',
                    fontFamily: '"Outfit", sans-serif',
                  }}
                >
                  {t.label}
                </Typography>
              </Box>
            ))}
          </Box>
        </Container>
      </Section>

      {/* ─── Footer ─────────────────────────────────────────────────── */}
      <Box
        component="footer"
        sx={{
          borderTop: `1px solid ${BORDER}`,
          py: 5,
          px: 2,
        }}
      >
        <Container maxWidth="lg">
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', md: 'row' },
              justifyContent: 'space-between',
              alignItems: { xs: 'center', md: 'flex-start' },
              gap: 3,
              mb: 4,
            }}
          >
            {/* Logo */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <img src="/favicon.png" alt="PrivaMargin" width={28} height={28} style={{ borderRadius: '7px' }} />
              <Typography
                sx={{
                  fontWeight: 600,
                  fontSize: 16,
                  fontFamily: '"Outfit", sans-serif',
                }}
              >
                Priva<span style={{ color: TEAL }}>Margin</span>
              </Typography>
            </Box>

            {/* Links */}
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
              {['Features', 'How It Works'].map((label) => (
                <Typography
                  key={label}
                  onClick={() => scrollTo(label.toLowerCase().replace(/\s+/g, '-'))}
                  sx={{
                    fontSize: 14,
                    color: 'rgba(255,255,255,0.4)',
                    cursor: 'pointer',
                    fontFamily: '"Outfit", sans-serif',
                    '&:hover': { color: 'rgba(255,255,255,0.7)' },
                    transition: 'color 0.2s',
                  }}
                >
                  {label}
                </Typography>
              ))}
              <Typography
                component="a"
                href={APP_URL}
                sx={{
                  fontSize: 14,
                  color: TEAL,
                  fontFamily: '"Outfit", sans-serif',
                  textDecoration: 'none',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                Launch App
              </Typography>
            </Box>
          </Box>

          <Box
            sx={{
              borderTop: `1px solid ${BORDER}`,
              pt: 3,
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <Typography
              sx={{
                fontSize: 13,
                color: 'rgba(255,255,255,0.3)',
                fontFamily: '"Outfit", sans-serif',
              }}
            >
              Built with Canton, Daml & ZK Proofs
            </Typography>
            <Typography
              sx={{
                fontSize: 13,
                color: 'rgba(255,255,255,0.25)',
                fontFamily: '"Outfit", sans-serif',
              }}
            >
              &copy; {new Date().getFullYear()} PrivaMargin. All rights reserved.
            </Typography>
          </Box>
        </Container>
      </Box>
    </Box>
  );
}
