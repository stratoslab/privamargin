import { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Chip, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Stepper, Step, StepLabel,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import { Add, TrendingUp, Close, ArrowBack, ArrowForward, Warning, Gavel, Shield } from '@mui/icons-material';
import { positionAPI, linkAPI, vaultAPI, getLivePrice, displaySymbol, getAssetPriceHistory, fetchZKProof } from '../services/api';
import TokenIcon from '../components/TokenIcon';
import type { PositionData, BrokerFundLinkData, LiquidationRecord } from '../services/api';
import { useRole } from '../context/RoleContext';
import type { AuthUser, Asset } from '@stratos-wallet/sdk';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';

interface PositionsProps {
  user: AuthUser;
  assets: Asset[];
}

function getLTVColor(ltv: number, threshold?: number): string {
  const t = threshold || 0.8;
  if (ltv >= t) return '#ef4444';
  if (ltv >= 0.6) return '#f59e0b';
  return '#00d4aa';
}

function getLTVLabel(ltv: number, threshold?: number): string {
  const t = threshold || 0.8;
  if (ltv >= t) return 'Critical';
  if (ltv >= 0.6) return 'Warning';
  return 'Healthy';
}

// Status chip styles
function statusChipSx(status: string) {
  const isOpen = status === 'Open';
  const isDanger = status === 'MarginCalled' || status === 'Liquidated';
  return {
    bgcolor: isOpen ? 'rgba(0,212,170,0.2)' : isDanger ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.1)',
    color: isOpen ? '#00d4aa' : isDanger ? '#ef4444' : 'rgba(255,255,255,0.5)',
    fontWeight: 600,
    fontSize: 11,
  };
}

// Shared table header cell style
const thSx = {
  color: 'rgba(255,255,255,0.5)',
  fontSize: 11,
  fontWeight: 600,
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  py: 1.5,
  px: 1.5,
  whiteSpace: 'nowrap' as const,
};

// Shared table body cell style
const tdSx = {
  color: 'white',
  fontSize: 13,
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  py: 1.5,
  px: 1.5,
};

const STEP_LABELS = ['Select Broker', 'Select Asset', 'Enter Units', 'Select Vault', 'Confirm'];

// Detail row helper
const detailRow = (label: string, value: string, color?: string) => (
  <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.8, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
    <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{label}</Typography>
    <Typography sx={{ fontSize: 13, fontWeight: 600, color: color || 'white' }}>{value}</Typography>
  </Box>
);

function ZKAttestationSection({ proofHash, proofTimestamp }: { proofHash: string; proofTimestamp?: string }) {
  const [verifyState, setVerifyState] = useState<'idle' | 'loading' | 'verified' | 'invalid'>('idle');

  const handleVerify = async () => {
    setVerifyState('loading');
    try {
      const proofData = await fetchZKProof(proofHash);
      if (!proofData) {
        setVerifyState('invalid');
        return;
      }
      const { verifyLTVProof } = await import('../services/zkProof');
      const data = proofData as { proof: unknown; publicSignals: string[] };
      const ok = await verifyLTVProof(data.proof as Parameters<typeof verifyLTVProof>[0], data.publicSignals);
      setVerifyState(ok ? 'verified' : 'invalid');
    } catch {
      setVerifyState('invalid');
    }
  };

  const truncatedHash = `${proofHash.slice(0, 10)}...${proofHash.slice(-8)}`;

  return (
    <Box sx={{ bgcolor: 'rgba(139,92,246,0.06)', borderRadius: '8px', p: 2, mb: 2, border: '1px solid rgba(139,92,246,0.2)' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Shield sx={{ color: '#8b5cf6', fontSize: 20 }} />
        <Typography sx={{ fontSize: 14, fontWeight: 600, color: '#8b5cf6' }}>ZK Collateral Attestation</Typography>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
        <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Proof Hash</Typography>
        <Typography sx={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(255,255,255,0.7)' }}>{truncatedHash}</Typography>
      </Box>
      {proofTimestamp && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
          <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Attested At</Typography>
          <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{new Date(proofTimestamp).toLocaleString()}</Typography>
        </Box>
      )}
      <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        {verifyState === 'idle' && (
          <Button
            size="small"
            startIcon={<Shield />}
            onClick={handleVerify}
            sx={{
              color: '#8b5cf6',
              bgcolor: 'rgba(139,92,246,0.12)',
              textTransform: 'none',
              fontSize: 12,
              fontWeight: 600,
              px: 1.5,
              '&:hover': { bgcolor: 'rgba(139,92,246,0.2)' },
            }}
          >
            Verify Proof
          </Button>
        )}
        {verifyState === 'loading' && (
          <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Verifying...</Typography>
        )}
        {verifyState === 'verified' && (
          <Chip label="Verified" size="small" sx={{ bgcolor: 'rgba(0,212,170,0.2)', color: '#00d4aa', fontWeight: 600, fontSize: 11 }} />
        )}
        {verifyState === 'invalid' && (
          <Chip label="Invalid" size="small" sx={{ bgcolor: 'rgba(239,68,68,0.2)', color: '#ef4444', fontWeight: 600, fontSize: 11 }} />
        )}
      </Box>
    </Box>
  );
}

function PositionDetailDialog({
  position,
  ltvThreshold,
  onClose,
}: {
  position: PositionData | null;
  ltvThreshold: number;
  onClose: () => void;
}) {
  const [liqRecord, setLiqRecord] = useState<LiquidationRecord | null>(null);
  const [priceHistory, setPriceHistory] = useState<Array<{ time: number; price: number }>>([]);
  const [chartDays, setChartDays] = useState(7);

  // Parse asset symbol from description (e.g. "LONG 2 BTC" → "BTC")
  const assetSymbol = position?.description?.split(' ').pop() || '';

  useEffect(() => {
    if (position?.status === 'Liquidated') {
      const record = positionAPI.getLiquidationRecord(position.positionId);
      setLiqRecord(record || null);
    } else {
      setLiqRecord(null);
    }
  }, [position]);

  useEffect(() => {
    if (!position || !assetSymbol) {
      setPriceHistory([]);
      return;
    }
    let cancelled = false;
    getAssetPriceHistory(assetSymbol, chartDays).then((data) => {
      if (!cancelled) setPriceHistory(data);
    });
    return () => { cancelled = true; };
  }, [position, assetSymbol, chartDays]);

  if (!position) return null;

  const ltvColor = getLTVColor(position.currentLTV, ltvThreshold);
  const pnl = position.unrealizedPnL || 0;

  return (
    <Dialog
      open={!!position}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { bgcolor: '#111820', color: 'white', maxHeight: '85vh' } }}
    >
      <DialogTitle sx={{ pb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 600 }}>{position.positionId}</Typography>
          {assetSymbol && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'rgba(245,158,11,0.15)', borderRadius: '12px', px: 1, py: 0.25 }}>
              <TokenIcon symbol={assetSymbol} size={16} />
              <Typography sx={{ color: '#f59e0b', fontWeight: 700, fontSize: 11 }}>{assetSymbol}</Typography>
            </Box>
          )}
          <Chip
            label={position.direction || 'Long'}
            size="small"
            sx={{
              bgcolor: position.direction === 'Short' ? 'rgba(239,68,68,0.15)' : 'rgba(0,212,170,0.15)',
              color: position.direction === 'Short' ? '#ef4444' : '#00d4aa',
              fontWeight: 700,
              fontSize: 10,
              height: 20,
            }}
          />
          <Chip label={position.status} size="small" sx={statusChipSx(position.status)} />
        </Box>
        <Button onClick={onClose} sx={{ color: 'rgba(255,255,255,0.4)', minWidth: 'auto' }}>
          <Close />
        </Button>
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {/* Header info — all statuses */}
        <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 2, mb: 2 }}>
          {detailRow('Description', position.description || '-')}
          {detailRow('Vault ID', position.vaultId)}
          {detailRow('Fund', position.fund.split('::')[0])}
          {detailRow('Broker', position.broker.split('::')[0])}
          {detailRow('Created', new Date(position.createdAt).toLocaleString())}
          {detailRow('Last Checked', new Date(position.lastChecked).toLocaleString())}
        </Box>

        {/* Price chart */}
        {priceHistory.length > 0 && (
          <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'white' }}>
                {assetSymbol} Price
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {([1, 7, 30] as const).map((d) => (
                  <Button
                    key={d}
                    size="small"
                    onClick={() => setChartDays(d)}
                    sx={{
                      minWidth: 36,
                      height: 24,
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'none',
                      color: chartDays === d ? '#f59e0b' : 'rgba(255,255,255,0.4)',
                      bgcolor: chartDays === d ? 'rgba(245,158,11,0.15)' : 'transparent',
                      borderRadius: '6px',
                      '&:hover': { bgcolor: chartDays === d ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)' },
                    }}
                  >
                    {d}d
                  </Button>
                ))}
              </Box>
            </Box>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={priceHistory}>
                <defs>
                  <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="time"
                  tickFormatter={(t: number) => {
                    const d = new Date(t);
                    return chartDays <= 1
                      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                  }}
                  tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  tickLine={false}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) => `$${v.toLocaleString()}`}
                  tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
                  axisLine={false}
                  tickLine={false}
                  width={70}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1a2332',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    fontSize: 12,
                    color: 'white',
                  }}
                  labelFormatter={(t: number) => new Date(t).toLocaleString()}
                  formatter={(value: number) => [`$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, 'Price']}
                />
                {position.entryPrice > 0 && (
                  <ReferenceLine
                    y={position.entryPrice}
                    stroke="#60a5fa"
                    strokeDasharray="4 4"
                    label={{ value: 'Entry', fill: '#60a5fa', fontSize: 10, position: 'right' }}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  fill="url(#priceGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        )}

        {/* Open / MarginCalled — active position details */}
        {(position.status === 'Open' || position.status === 'MarginCalled') && (
          <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 2, mb: 2 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'white', mb: 1 }}>Position Details</Typography>
            {detailRow('Notional Value', `$${position.notionalValue.toLocaleString()}`)}
            {detailRow('Collateral Value',
              position.collateralValue ? `$${position.collateralValue.toLocaleString()}` : 'Encrypted',
              position.collateralValue ? undefined : 'rgba(255,255,255,0.25)',
            )}
            {detailRow('Entry Price', position.entryPrice ? `$${position.entryPrice.toLocaleString()}` : '-')}
            {detailRow('Units', position.units ? position.units.toLocaleString() : '-')}
            {detailRow('Unrealized PnL',
              `${pnl >= 0 ? '+' : ''}$${pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
              pnl >= 0 ? '#00d4aa' : '#ef4444',
            )}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.8 }}>
              <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Current LTV</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: ltvColor }}>
                  {(position.currentLTV * 100).toFixed(1)}%
                </Typography>
                <Box sx={{ width: 60, height: 6, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 3, position: 'relative' }}>
                  <Box sx={{ width: `${Math.min(position.currentLTV * 100, 100)}%`, height: '100%', bgcolor: ltvColor, borderRadius: 3 }} />
                </Box>
              </Box>
            </Box>
            {detailRow('LTV Threshold', `${(ltvThreshold * 100).toFixed(0)}%`, '#f59e0b')}

            {position.status === 'MarginCalled' && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5, p: 1.5, bgcolor: 'rgba(239,68,68,0.1)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)' }}>
                <Warning sx={{ color: '#ef4444', fontSize: 18 }} />
                <Typography sx={{ fontSize: 12, color: '#ef4444' }}>
                  LTV has breached the {(ltvThreshold * 100).toFixed(0)}% threshold. Position is at risk of liquidation.
                </Typography>
              </Box>
            )}
          </Box>
        )}

        {/* Liquidated — liquidation breakdown */}
        {position.status === 'Liquidated' && (
          <Box>
            <Box sx={{ bgcolor: 'rgba(239,68,68,0.08)', borderRadius: '8px', p: 2, mb: 2, border: '1px solid rgba(239,68,68,0.2)' }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600, color: '#ef4444', mb: 1 }}>
                Liquidation Summary
              </Typography>
              {/* Price & PnL details — always shown from on-ledger data */}
              {detailRow('Notional Value', `$${position.notionalValue.toLocaleString()}`)}
              {detailRow('Units', position.units ? position.units.toLocaleString() : '-')}
              {detailRow('Entry Price', position.entryPrice ? `$${position.entryPrice.toLocaleString()}` : '-')}
              {detailRow('Closing Price', position.closingPrice ? `$${position.closingPrice.toLocaleString()}` : '-')}
              {detailRow('PnL at Liquidation',
                `${pnl >= 0 ? '+' : ''}$${pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                pnl >= 0 ? '#00d4aa' : '#ef4444',
              )}
              {liqRecord ? (
                <>
                  {detailRow('Liquidated At', new Date(liqRecord.liquidatedAt).toLocaleString())}
                  {detailRow('Amount Owed', `$${liqRecord.liquidationAmountUSD.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, '#ef4444')}
                  {detailRow('Collateral at Liquidation', `$${liqRecord.collateralValueAtLiquidation.toLocaleString()}`)}
                  {detailRow('LTV at Liquidation', `${(liqRecord.ltvAtLiquidation * 100).toFixed(1)}%`, '#ef4444')}
                  {detailRow('LTV Threshold', `${(liqRecord.ltvThreshold * 100).toFixed(0)}%`, '#f59e0b')}
                </>
              ) : (
                <>
                  {detailRow('Collateral Value',
                    position.collateralValue ? `$${position.collateralValue.toLocaleString()}` : 'Encrypted',
                    position.collateralValue ? undefined : 'rgba(255,255,255,0.25)',
                  )}
                  <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', mt: 1, fontStyle: 'italic' }}>
                    Detailed seizure breakdown not available (liquidated before this session)
                  </Typography>
                </>
              )}
            </Box>

            {/* EVM Escrow Seizures table */}
            {liqRecord && liqRecord.escrowLiquidations.length > 0 && (
              <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 2, mb: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'white', mb: 1 }}>EVM Escrow Seizures</Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ ...thSx, py: 1 }}>Chain</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }}>Escrow</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }} align="right">ETH</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }} align="right">USDC</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }}>Tx</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {liqRecord.escrowLiquidations.map((esc, i) => (
                        <TableRow key={i}>
                          <TableCell sx={{ ...tdSx, fontSize: 12 }}>{esc.chain}</TableCell>
                          <TableCell sx={{ ...tdSx, fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.5)' }}>
                            {esc.custodyAddress.slice(0, 8)}...{esc.custodyAddress.slice(-6)}
                          </TableCell>
                          <TableCell sx={{ ...tdSx, fontSize: 12, fontWeight: 600 }} align="right">
                            {parseFloat(esc.ethSeized) > 0 ? `${esc.ethSeized} ($${esc.ethValueUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })})` : '-'}
                          </TableCell>
                          <TableCell sx={{ ...tdSx, fontSize: 12, fontWeight: 600 }} align="right">
                            {parseFloat(esc.usdcSeized) > 0 ? `$${esc.usdcSeized}` : '-'}
                          </TableCell>
                          <TableCell sx={{ ...tdSx, fontSize: 11 }}>
                            {esc.txHashes.length > 0 ? esc.txHashes.map((tx, j) => (
                              <Typography key={j} sx={{ fontSize: 11, fontFamily: 'monospace', color: '#60a5fa' }}>
                                {tx.slice(0, 10)}...
                              </Typography>
                            )) : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            {/* CC Seized table */}
            {liqRecord && liqRecord.ccSeized.length > 0 && (
              <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 2, mb: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'white', mb: 1 }}>CC Assets Seized</Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ ...thSx, py: 1 }}>Symbol</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }} align="right">Amount</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }} align="right">Value USD</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {liqRecord.ccSeized.map((cc, i) => (
                        <TableRow key={i}>
                          <TableCell sx={{ ...tdSx, fontSize: 12, fontWeight: 600 }}>{displaySymbol(cc.symbol)}</TableCell>
                          <TableCell sx={{ ...tdSx, fontSize: 12 }} align="right">{cc.amount.toLocaleString()}</TableCell>
                          <TableCell sx={{ ...tdSx, fontSize: 12, fontWeight: 600 }} align="right">${cc.valueUSD.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            {/* Canton Settlement table */}
            {liqRecord && liqRecord.cantonSettlement && liqRecord.cantonSettlement.length > 0 && (
              <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 2, mb: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'white', mb: 1 }}>Canton Settlement</Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ ...thSx, py: 1 }}>Symbol</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }} align="right">Amount</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }} align="right">Value USD</TableCell>
                        <TableCell sx={{ ...thSx, py: 1 }}>Source</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {liqRecord.cantonSettlement.map((cs, i) => (
                        <TableRow key={i}>
                          <TableCell sx={{ ...tdSx, fontSize: 12, fontWeight: 600 }}>{displaySymbol(cs.symbol)}</TableCell>
                          <TableCell sx={{ ...tdSx, fontSize: 12 }} align="right">{cs.amount.toLocaleString()}</TableCell>
                          <TableCell sx={{ ...tdSx, fontSize: 12, fontWeight: 600 }} align="right">${cs.valueUSD.toLocaleString()}</TableCell>
                          <TableCell sx={{ ...tdSx, fontSize: 12 }}>
                            <Chip
                              label={cs.source === 'bridge' ? 'Bridge' : 'Direct'}
                              size="small"
                              sx={{
                                bgcolor: cs.source === 'bridge' ? 'rgba(96,165,250,0.15)' : 'rgba(0,212,170,0.15)',
                                color: cs.source === 'bridge' ? '#60a5fa' : '#00d4aa',
                                fontWeight: 600, fontSize: 10, height: 20,
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            {/* Broker recipient + totals */}
            {liqRecord && (
              <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 2 }}>
                {liqRecord.brokerCantonParty && detailRow('Broker Canton Party', `${liqRecord.brokerCantonParty.split('::')[0]}`)}
                {liqRecord.brokerRecipient && detailRow('Broker EVM Address', `${liqRecord.brokerRecipient.slice(0, 10)}...${liqRecord.brokerRecipient.slice(-8)}`)}
                {(() => {
                  const totalEscrowUSD = liqRecord.escrowLiquidations.reduce((s, e) => s + e.ethValueUSD + (parseFloat(e.usdcSeized) || 0), 0);
                  const totalCCUSD = liqRecord.ccSeized.reduce((s, c) => s + c.valueUSD, 0);
                  const totalCantonUSD = (liqRecord.cantonSettlement || []).reduce((s, c) => s + c.valueUSD, 0);
                  return (
                    <>
                      {detailRow('Total Seized', `$${(totalEscrowUSD + totalCCUSD).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)}
                      {totalCantonUSD > 0 && detailRow('Canton Settlement Total', `$${totalCantonUSD.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, '#60a5fa')}
                      {detailRow('Amount Owed', `$${liqRecord.liquidationAmountUSD.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, '#ef4444')}
                    </>
                  );
                })()}
              </Box>
            )}
          </Box>
        )}

        {/* Closed — close details with prices */}
        {position.status === 'Closed' && (
          <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 2 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'white', mb: 1 }}>Close Details</Typography>
            {detailRow('Notional Value', `$${position.notionalValue.toLocaleString()}`)}
            {detailRow('Units', position.units ? position.units.toLocaleString() : '-')}
            {detailRow('Entry Price', position.entryPrice ? `$${position.entryPrice.toLocaleString()}` : '-')}
            {detailRow('Closing Price', position.closingPrice ? `$${position.closingPrice.toLocaleString()}` : '-')}
            {detailRow('Final PnL',
              `${pnl >= 0 ? '+' : ''}$${pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
              pnl >= 0 ? '#00d4aa' : '#ef4444',
            )}
          </Box>
        )}

        {/* ZK Collateral Attestation */}
        {position.zkCollateralProofHash && (
          <ZKAttestationSection
            proofHash={position.zkCollateralProofHash}
            proofTimestamp={position.zkProofTimestamp}
          />
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: 'rgba(255,255,255,0.5)', textTransform: 'none' }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Fund View
function FundPositions({ user }: { user: AuthUser }) {
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [links, setLinks] = useState<BrokerFundLinkData[]>([]);
  const [vaults, setVaults] = useState<any[]>([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [detailPosition, setDetailPosition] = useState<PositionData | null>(null);

  // Multi-step form state
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ broker: '', asset: '', units: '', vaultId: '', direction: 'Long' as 'Long' | 'Short' });
  const [livePrice, setLivePrice] = useState<number | null>(null);

  const partyId = user.partyId || user.id;

  useEffect(() => {
    loadData();
  }, [user]);

  const loadData = async () => {
    try {
      const [posRes, linkRes, vaultRes] = await Promise.all([
        positionAPI.listByFund(partyId),
        linkAPI.getLinksForFund(partyId),
        vaultAPI.getByOwner(partyId),
      ]);
      setPositions(posRes.data);
      setLinks(linkRes.data);
      setVaults(vaultRes.data);
    } catch (error) {
      console.error('Error loading positions:', error);
    }
  };

  // Derived values
  const selectedLink = links.find(l => l.broker === form.broker);
  const allowedAssets = selectedLink?.allowedAssets || [];
  const notionalValue = form.units && livePrice ? parseFloat(form.units) * livePrice : 0;
  const selectedVault = vaults.find((v: any) => v.vaultId === form.vaultId);

  // Sum existing open positions' notional on the selected vault for aggregate LTV preview
  const existingNotionalOnVault = (vaultId: string) =>
    positions.filter(p => p.vaultId === vaultId && (p.status === 'Open' || p.status === 'MarginCalled'))
      .reduce((sum, p) => sum + p.notionalValue, 0);

  const selectedLeverage = selectedLink?.leverageRatio || 1;
  const ltvPreview = selectedVault && selectedVault.totalValue > 0
    ? (existingNotionalOnVault(selectedVault.vaultId) + notionalValue) / (selectedVault.totalValue * selectedLeverage)
    : 0;

  // Fetch live price when asset changes
  useEffect(() => {
    if (form.asset) {
      getLivePrice(form.asset).then(price => setLivePrice(price));
    } else {
      setLivePrice(null);
    }
  }, [form.asset]);

  const resetForm = () => {
    setStep(1);
    setForm({ broker: '', asset: '', units: '', vaultId: '', direction: 'Long' });
    setLivePrice(null);
  };

  const handleCreate = async () => {
    if (!form.vaultId || !form.broker || !notionalValue) return;
    setCreating(true);
    try {
      const operator = selectedLink?.operator || partyId;
      const description = `${form.direction.toUpperCase()} ${form.units} ${form.asset}`;

      // Re-fetch live price right before creation to avoid stale fallback
      const freshPrice = await getLivePrice(form.asset);
      const freshNotional = parseFloat(form.units) * freshPrice;

      await positionAPI.create(
        partyId,
        form.broker,
        operator,
        form.vaultId,
        description,
        freshNotional,
        form.direction,
        freshPrice,
        parseFloat(form.units) || 0,
      );
      setOpenCreate(false);
      resetForm();
      await loadData();
    } catch (error) {
      console.error('Error creating position:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleClose = async (positionId: string) => {
    setClosing(positionId);
    try {
      await positionAPI.close(positionId);
      await loadData();
    } catch (error) {
      console.error('Error closing position:', error);
    } finally {
      setClosing(null);
    }
  };

  const getThreshold = (broker: string) => {
    const link = links.find(l => l.broker === broker);
    return link?.ltvThreshold || 0.8;
  };

  const activeLinks = links.filter(l => l.isActive);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
        <Box>
          <Typography sx={{ fontSize: 28, fontWeight: 600, color: 'white', mb: 0.5 }}>Positions</Typography>
          <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
            Manage positions and monitor LTV ratios
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={async () => { resetForm(); await loadData(); setOpenCreate(true); }}
          disabled={activeLinks.length === 0 || vaults.length === 0}
          sx={{
            bgcolor: '#00d4aa',
            color: '#0a0e14',
            fontWeight: 600,
            px: 3,
            py: 1,
            borderRadius: '8px',
            textTransform: 'none',
            '&:hover': { bgcolor: '#00c49a' },
          }}
        >
          Open Position
        </Button>
      </Box>

      {links.length === 0 && (
        <Box sx={{ bgcolor: 'rgba(245,158,11,0.1)', borderRadius: '8px', p: 2, mb: 3, border: '1px solid rgba(245,158,11,0.3)' }}>
          <Typography sx={{ fontSize: 13, color: '#f59e0b' }}>
            You need to link with a broker before opening positions. Go to "My Brokers" to accept an invitation.
          </Typography>
        </Box>
      )}

      {/* Position Table */}
      {positions.length === 0 ? (
        <Box
          sx={{
            bgcolor: '#111820',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.06)',
            p: 3,
            textAlign: 'center',
            py: 6,
          }}
        >
          <TrendingUp sx={{ fontSize: 48, color: 'rgba(255,255,255,0.15)', mb: 1 }} />
          <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'rgba(255,255,255,0.6)', mb: 0.5 }}>
            No Positions
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
            Open a position to start margin tracking
          </Typography>
        </Box>
      ) : (
        <TableContainer sx={{ bgcolor: '#111820', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={thSx}>Position</TableCell>
                <TableCell sx={thSx}>Asset</TableCell>
                <TableCell sx={thSx}>Direction</TableCell>
                <TableCell sx={thSx} align="right">Notional</TableCell>
                <TableCell sx={thSx} align="right">Collateral</TableCell>
                <TableCell sx={thSx} align="right">PnL</TableCell>
                <TableCell sx={thSx} align="right">LTV</TableCell>
                <TableCell sx={thSx}>Status</TableCell>
                <TableCell sx={thSx}>Broker</TableCell>
                <TableCell sx={thSx} align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {positions.map((pos) => {
                const threshold = getThreshold(pos.broker);
                const ltvColor = getLTVColor(pos.currentLTV, threshold);
                return (
                  <TableRow
                    key={pos.contractId}
                    onClick={() => setDetailPosition(pos)}
                    sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' }, cursor: 'pointer' }}
                  >
                    <TableCell sx={tdSx}>
                      <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{pos.positionId}</Typography>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Vault: {pos.vaultId}</Typography>
                    </TableCell>
                    <TableCell sx={tdSx}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {pos.assetSymbol && <TokenIcon symbol={pos.assetSymbol} size={20} />}
                        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{pos.assetSymbol || '-'}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={tdSx}>
                      <Chip
                        label={pos.direction || 'Long'}
                        size="small"
                        sx={{
                          bgcolor: pos.direction === 'Short' ? 'rgba(239,68,68,0.15)' : 'rgba(0,212,170,0.15)',
                          color: pos.direction === 'Short' ? '#ef4444' : '#00d4aa',
                          fontWeight: 700,
                          fontSize: 10,
                          height: 20,
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ ...tdSx, fontWeight: 600 }} align="right">
                      ${pos.notionalValue.toLocaleString()}
                    </TableCell>
                    <TableCell sx={{ ...tdSx, fontWeight: 600 }} align="right">
                      ${pos.collateralValue.toLocaleString()}
                    </TableCell>
                    <TableCell sx={{ ...tdSx, fontWeight: 600, color: pos.unrealizedPnL >= 0 ? '#00d4aa' : '#ef4444' }} align="right">
                      {pos.unrealizedPnL >= 0 ? '+' : ''}${pos.unrealizedPnL.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell sx={tdSx} align="right">
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 700, color: ltvColor }}>
                          {(pos.currentLTV * 100).toFixed(1)}%
                        </Typography>
                        <Chip
                          label={getLTVLabel(pos.currentLTV, threshold)}
                          size="small"
                          sx={{
                            bgcolor: `${ltvColor}20`,
                            color: ltvColor,
                            fontWeight: 600,
                            fontSize: 9,
                            height: 18,
                          }}
                        />
                      </Box>
                    </TableCell>
                    <TableCell sx={tdSx}>
                      <Chip label={pos.status} size="small" sx={statusChipSx(pos.status)} />
                    </TableCell>
                    <TableCell sx={{ ...tdSx, color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                      {pos.broker.split('::')[0]}
                    </TableCell>
                    <TableCell sx={tdSx} align="right">
                      {pos.status === 'Open' && (
                        <Button
                          size="small"
                          startIcon={<Close />}
                          onClick={(e) => { e.stopPropagation(); handleClose(pos.positionId); }}
                          disabled={closing === pos.positionId}
                          sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: 11, minWidth: 0 }}
                        >
                          {closing === pos.contractId ? '...' : 'Close'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create Position Dialog — 5-step flow */}
      <Dialog
        open={openCreate}
        onClose={() => { setOpenCreate(false); resetForm(); }}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#111820', color: 'white' } }}
      >
        <DialogTitle sx={{ pb: 1 }}>Open New Position</DialogTitle>
        <DialogContent>
          <Stepper
            activeStep={step - 1}
            alternativeLabel
            sx={{
              mb: 3, mt: 1,
              '& .MuiStepLabel-label': { color: 'rgba(255,255,255,0.4)', fontSize: 11 },
              '& .MuiStepLabel-label.Mui-active': { color: '#00d4aa' },
              '& .MuiStepLabel-label.Mui-completed': { color: '#00d4aa' },
              '& .MuiStepIcon-root': { color: 'rgba(255,255,255,0.1)' },
              '& .MuiStepIcon-root.Mui-active': { color: '#00d4aa' },
              '& .MuiStepIcon-root.Mui-completed': { color: '#00d4aa' },
            }}
          >
            {STEP_LABELS.map(label => (
              <Step key={label}><StepLabel>{label}</StepLabel></Step>
            ))}
          </Stepper>

          {/* Step 1: Select Broker */}
          {step === 1 && (
            <Box>
              <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', mb: 2 }}>
                Choose a broker to trade with
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {activeLinks.map(link => (
                  <Box
                    key={link.broker}
                    onClick={() => { setForm({ ...form, broker: link.broker, asset: '' }); setStep(2); }}
                    sx={{
                      p: 2,
                      borderRadius: '8px',
                      border: form.broker === link.broker
                        ? '1px solid rgba(0,212,170,0.5)'
                        : '1px solid rgba(255,255,255,0.1)',
                      bgcolor: form.broker === link.broker
                        ? 'rgba(0,212,170,0.05)'
                        : 'rgba(255,255,255,0.02)',
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'rgba(0,212,170,0.08)' },
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'white' }}>
                        {link.broker.split('::')[0]}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Chip label={`LTV ${(link.ltvThreshold * 100).toFixed(0)}%`} size="small"
                          sx={{ bgcolor: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontWeight: 600, fontSize: 11 }} />
                        {link.leverageRatio > 1 && (
                          <Chip label={`${link.leverageRatio}x`} size="small"
                            sx={{ bgcolor: 'rgba(59,130,246,0.15)', color: '#3b82f6', fontWeight: 600, fontSize: 11 }} />
                        )}
                        <Chip label={`${link.allowedAssets?.length || 0} assets`} size="small"
                          sx={{ bgcolor: 'rgba(139,92,246,0.15)', color: '#8b5cf6', fontWeight: 600, fontSize: 11 }} />
                      </Box>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* Step 2: Select Asset */}
          {step === 2 && (
            <Box>
              <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', mb: 2 }}>
                Select asset from {selectedLink?.broker.split('::')[0]}'s allowed list
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {allowedAssets.map(asset => (
                  <Chip
                    key={asset}
                    label={asset}
                    onClick={() => { setForm({ ...form, asset }); setStep(3); }}
                    sx={{
                      bgcolor: form.asset === asset ? 'rgba(0,212,170,0.2)' : 'rgba(255,255,255,0.05)',
                      color: form.asset === asset ? '#00d4aa' : 'rgba(255,255,255,0.6)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: 13,
                      py: 2.5,
                      border: form.asset === asset ? '1px solid rgba(0,212,170,0.4)' : '1px solid rgba(255,255,255,0.1)',
                      '&:hover': { bgcolor: 'rgba(0,212,170,0.1)' },
                    }}
                  />
                ))}
              </Box>
              {allowedAssets.length === 0 && (
                <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center', py: 3 }}>
                  No assets configured for this broker
                </Typography>
              )}
            </Box>
          )}

          {/* Step 3: Direction + Enter Units */}
          {step === 3 && (
            <Box>
              <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', mb: 2 }}>
                Choose direction and enter units
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                {(['Long', 'Short'] as const).map(dir => (
                  <Chip
                    key={dir}
                    label={dir}
                    onClick={() => setForm({ ...form, direction: dir })}
                    sx={{
                      bgcolor: form.direction === dir
                        ? dir === 'Long' ? 'rgba(0,212,170,0.2)' : 'rgba(239,68,68,0.2)'
                        : 'rgba(255,255,255,0.05)',
                      color: form.direction === dir
                        ? dir === 'Long' ? '#00d4aa' : '#ef4444'
                        : 'rgba(255,255,255,0.5)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: 14,
                      px: 2,
                      py: 2.5,
                      border: form.direction === dir
                        ? `1px solid ${dir === 'Long' ? 'rgba(0,212,170,0.4)' : 'rgba(239,68,68,0.4)'}`
                        : '1px solid rgba(255,255,255,0.1)',
                      '&:hover': { bgcolor: dir === 'Long' ? 'rgba(0,212,170,0.1)' : 'rgba(239,68,68,0.1)' },
                    }}
                  />
                ))}
              </Box>
              <TextField
                fullWidth
                autoFocus
                label={`Units of ${form.asset}`}
                type="number"
                value={form.units}
                onChange={(e) => setForm({ ...form, units: e.target.value })}
                sx={{
                  mb: 2,
                  '& .MuiOutlinedInput-root': {
                    color: 'white',
                    '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
                  },
                  '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.5)' },
                }}
              />
              {livePrice !== null && (
                <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Live Price</Typography>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'white' }}>
                      ${livePrice.toLocaleString()}
                    </Typography>
                  </Box>
                  {form.units && parseFloat(form.units) > 0 && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Notional Value</Typography>
                      <Typography sx={{ fontSize: 16, fontWeight: 700, color: '#00d4aa' }}>
                        ${notionalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          )}

          {/* Step 4: Select Vault */}
          {step === 4 && (
            <Box>
              <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', mb: 2 }}>
                Select a vault to back this position
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {vaults.map((v: any) => {
                  const totalNotional = existingNotionalOnVault(v.vaultId) + notionalValue;
                  const leverage = selectedLink?.leverageRatio || 1;
                  const projectedLTV = v.totalValue > 0 ? totalNotional / (v.totalValue * leverage) : 0;
                  const threshold = selectedLink?.ltvThreshold || 0.8;
                  const ltvColor = getLTVColor(projectedLTV, threshold);
                  return (
                    <Box
                      key={v.vaultId}
                      onClick={() => { setForm({ ...form, vaultId: v.vaultId }); setStep(5); }}
                      sx={{
                        p: 2,
                        borderRadius: '8px',
                        border: form.vaultId === v.vaultId
                          ? '1px solid rgba(0,212,170,0.5)'
                          : '1px solid rgba(255,255,255,0.1)',
                        bgcolor: form.vaultId === v.vaultId
                          ? 'rgba(0,212,170,0.05)'
                          : 'rgba(255,255,255,0.02)',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'rgba(0,212,170,0.08)' },
                      }}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box>
                          <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'white' }}>
                            {v.vaultId}
                          </Typography>
                          <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                            Collateral: ${v.totalValue.toLocaleString()}
                          </Typography>
                        </Box>
                        <Box sx={{ textAlign: 'right' }}>
                          <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Projected LTV</Typography>
                          <Typography sx={{ fontSize: 16, fontWeight: 700, color: ltvColor }}>
                            {(projectedLTV * 100).toFixed(1)}%
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}

          {/* Step 5: Confirm */}
          {step === 5 && (
            <Box>
              <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', mb: 2 }}>
                Review and confirm your position
              </Typography>
              <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 2.5 }}>
                {[
                  { label: 'Broker', value: selectedLink?.broker.split('::')[0] || '' },
                  { label: 'Direction', value: form.direction, color: form.direction === 'Long' ? '#00d4aa' : '#ef4444' },
                  { label: 'Asset', value: form.asset },
                  { label: 'Units', value: form.units },
                  { label: 'Entry Price', value: livePrice ? `$${livePrice.toLocaleString()}` : '-' },
                  { label: 'Notional Value', value: `$${notionalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}` },
                  { label: 'Vault', value: form.vaultId },
                  { label: 'Collateral', value: `$${selectedVault?.totalValue.toLocaleString() || '0'}` },
                  { label: 'Projected LTV', value: `${(ltvPreview * 100).toFixed(1)}%`, color: getLTVColor(ltvPreview, selectedLink?.ltvThreshold) },
                ].map(row => (
                  <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.8, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{row.label}</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: row.color || 'white' }}>{row.value}</Typography>
                  </Box>
                ))}
              </Box>

              {ltvPreview >= (selectedLink?.ltvThreshold || 0.8) && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2, p: 1.5, bgcolor: 'rgba(239,68,68,0.1)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)' }}>
                  <Warning sx={{ color: '#ef4444', fontSize: 18 }} />
                  <Typography sx={{ fontSize: 12, color: '#ef4444' }}>
                    LTV exceeds threshold ({((selectedLink?.ltvThreshold || 0.8) * 100).toFixed(0)}%). This position may trigger an immediate margin call.
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => { setOpenCreate(false); resetForm(); }}
            sx={{ color: 'rgba(255,255,255,0.5)' }}
          >
            Cancel
          </Button>
          {step > 1 && (
            <Button
              startIcon={<ArrowBack />}
              onClick={() => setStep(step - 1)}
              sx={{ color: 'rgba(255,255,255,0.6)', textTransform: 'none' }}
            >
              Back
            </Button>
          )}
          {step === 3 && (
            <Button
              variant="contained"
              endIcon={<ArrowForward />}
              onClick={() => setStep(4)}
              disabled={!form.units || parseFloat(form.units) <= 0}
              sx={{ bgcolor: '#00d4aa', color: '#0a0e14', textTransform: 'none', '&:hover': { bgcolor: '#00c49a' } }}
            >
              Next
            </Button>
          )}
          {step === 5 && (
            <Button
              variant="contained"
              onClick={handleCreate}
              disabled={creating}
              sx={{ bgcolor: '#00d4aa', color: '#0a0e14', fontWeight: 600, textTransform: 'none', '&:hover': { bgcolor: '#00c49a' } }}
            >
              {creating ? 'Creating...' : 'Confirm & Open'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Position Detail Dialog */}
      <PositionDetailDialog
        position={detailPosition}
        ltvThreshold={detailPosition ? getThreshold(detailPosition.broker) : 0.8}
        onClose={() => setDetailPosition(null)}
      />
    </Box>
  );
}

// Broker View
function BrokerPositions({ user }: { user: AuthUser }) {
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [links, setLinks] = useState<BrokerFundLinkData[]>([]);
  const [filterFund, setFilterFund] = useState('');
  const [liquidating, setLiquidating] = useState<string | null>(null);
  const [openLiquidateConfirm, setOpenLiquidateConfirm] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<PositionData | null>(null);
  const [liquidateError, setLiquidateError] = useState('');
  const [detailPosition, setDetailPosition] = useState<PositionData | null>(null);

  const partyId = user.partyId || user.id;

  useEffect(() => {
    loadData();
  }, [user]);

  const loadData = async () => {
    try {
      const [posRes, linkRes] = await Promise.all([
        positionAPI.listByBroker(partyId),
        linkAPI.getLinksForBroker(partyId),
      ]);
      setPositions(posRes.data);
      setLinks(linkRes.data);
    } catch (error) {
      console.error('Error loading positions:', error);
    }
  };

  const getThreshold = (fund: string) => {
    const link = links.find(l => l.fund === fund);
    return link?.ltvThreshold || 0.8;
  };

  const handleLiquidateClick = (pos: PositionData) => {
    setSelectedPosition(pos);
    setLiquidateError('');
    setOpenLiquidateConfirm(true);
  };

  const handleLiquidateConfirm = async () => {
    if (!selectedPosition) return;
    setLiquidating(selectedPosition.positionId);
    setLiquidateError('');
    try {
      await positionAPI.liquidate(selectedPosition.positionId);
      setOpenLiquidateConfirm(false);
      setSelectedPosition(null);
      await loadData();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Liquidation failed';
      setLiquidateError(msg);
      console.error('Liquidation failed:', error);
    } finally {
      setLiquidating(null);
    }
  };

  const uniqueFunds = [...new Set(positions.map(p => p.fund))];
  const filteredPositions = filterFund
    ? positions.filter(p => p.fund === filterFund)
    : positions;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
        <Box>
          <Typography sx={{ fontSize: 28, fontWeight: 600, color: 'white', mb: 0.5 }}>Positions Overview</Typography>
          <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
            Monitor positions across all linked funds
          </Typography>
        </Box>
      </Box>

      {/* Fund filter */}
      {uniqueFunds.length > 1 && (
        <Box sx={{ mb: 3, display: 'flex', gap: 1 }}>
          <Chip
            label="All Funds"
            onClick={() => setFilterFund('')}
            sx={{
              bgcolor: !filterFund ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.05)',
              color: !filterFund ? '#8b5cf6' : 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
            }}
          />
          {uniqueFunds.map(f => (
            <Chip
              key={f}
              label={f.split('::')[0]}
              onClick={() => setFilterFund(f)}
              sx={{
                bgcolor: filterFund === f ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.05)',
                color: filterFund === f ? '#8b5cf6' : 'rgba(255,255,255,0.5)',
                cursor: 'pointer',
              }}
            />
          ))}
        </Box>
      )}

      {filteredPositions.length === 0 ? (
        <Box
          sx={{
            bgcolor: '#111820',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.06)',
            p: 3,
            textAlign: 'center',
            py: 6,
          }}
        >
          <TrendingUp sx={{ fontSize: 48, color: 'rgba(255,255,255,0.15)', mb: 1 }} />
          <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'rgba(255,255,255,0.6)' }}>
            No Positions
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
            No fund positions to monitor yet
          </Typography>
        </Box>
      ) : (
        <TableContainer sx={{ bgcolor: '#111820', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={thSx}>Position</TableCell>
                <TableCell sx={thSx}>Fund</TableCell>
                <TableCell sx={thSx}>Asset</TableCell>
                <TableCell sx={thSx}>Direction</TableCell>
                <TableCell sx={thSx} align="right">Notional</TableCell>
                <TableCell sx={thSx} align="right">Collateral</TableCell>
                <TableCell sx={thSx} align="right">PnL</TableCell>
                <TableCell sx={thSx} align="right">LTV</TableCell>
                <TableCell sx={thSx} align="center">Threshold</TableCell>
                <TableCell sx={thSx}>Status</TableCell>
                <TableCell sx={thSx} align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredPositions.map((pos) => {
                const threshold = getThreshold(pos.fund);
                const ltvColor = getLTVColor(pos.currentLTV, threshold);
                const canLiquidate = (pos.status === 'Open' || pos.status === 'MarginCalled') && pos.currentLTV >= threshold;
                return (
                  <TableRow
                    key={pos.contractId}
                    onClick={() => setDetailPosition(pos)}
                    sx={{
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' },
                      bgcolor: pos.currentLTV >= threshold * 0.9 ? `${ltvColor}08` : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <TableCell sx={tdSx}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{pos.positionId}</Typography>
                        {pos.zkCollateralProofHash && (
                          <Shield sx={{ fontSize: 14, color: '#8b5cf6', opacity: 0.8 }} />
                        )}
                      </Box>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Vault: {pos.vaultId}</Typography>
                    </TableCell>
                    <TableCell sx={{ ...tdSx, color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                      {pos.fund.split('::')[0]}
                    </TableCell>
                    <TableCell sx={tdSx}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {pos.assetSymbol && <TokenIcon symbol={pos.assetSymbol} size={20} />}
                        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{pos.assetSymbol || '-'}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={tdSx}>
                      <Chip
                        label={pos.direction || 'Long'}
                        size="small"
                        sx={{
                          bgcolor: pos.direction === 'Short' ? 'rgba(239,68,68,0.15)' : 'rgba(0,212,170,0.15)',
                          color: pos.direction === 'Short' ? '#ef4444' : '#00d4aa',
                          fontWeight: 700,
                          fontSize: 10,
                          height: 20,
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ ...tdSx, fontWeight: 600 }} align="right">
                      ${pos.notionalValue.toLocaleString()}
                    </TableCell>
                    <TableCell sx={{ ...tdSx, fontWeight: 600, color: 'rgba(255,255,255,0.25)', fontStyle: pos.collateralValue ? 'normal' : 'italic' }} align="right">
                      {pos.collateralValue ? `$${pos.collateralValue.toLocaleString()}` : 'Encrypted'}
                    </TableCell>
                    <TableCell sx={{ ...tdSx, fontWeight: 600, color: pos.unrealizedPnL >= 0 ? '#00d4aa' : '#ef4444' }} align="right">
                      {pos.unrealizedPnL >= 0 ? '+' : ''}${pos.unrealizedPnL.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell sx={tdSx} align="right">
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                        <Typography sx={{ fontSize: 14, fontWeight: 700, color: ltvColor }}>
                          {(pos.currentLTV * 100).toFixed(1)}%
                        </Typography>
                        {/* Mini LTV bar */}
                        <Box sx={{ width: 40, height: 4, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 2, position: 'relative', ml: 0.5 }}>
                          <Box sx={{ width: `${Math.min(pos.currentLTV * 100, 100)}%`, height: '100%', bgcolor: ltvColor, borderRadius: 2 }} />
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell sx={tdSx} align="center">
                      <Typography sx={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
                        {(threshold * 100).toFixed(0)}%
                      </Typography>
                    </TableCell>
                    <TableCell sx={tdSx}>
                      <Chip label={pos.status} size="small" sx={statusChipSx(pos.status)} />
                    </TableCell>
                    <TableCell sx={tdSx} align="right">
                      {canLiquidate && (
                        <Button
                          size="small"
                          startIcon={<Gavel />}
                          onClick={(e) => { e.stopPropagation(); handleLiquidateClick(pos); }}
                          disabled={liquidating === pos.contractId}
                          sx={{
                            color: '#ef4444',
                            bgcolor: 'rgba(239,68,68,0.1)',
                            textTransform: 'none',
                            fontSize: 11,
                            fontWeight: 600,
                            px: 1.5,
                            minWidth: 0,
                            '&:hover': { bgcolor: 'rgba(239,68,68,0.2)' },
                          }}
                        >
                          {liquidating === pos.contractId ? '...' : 'Liquidate'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Liquidation Confirmation Dialog */}
      <Dialog
        open={openLiquidateConfirm}
        onClose={() => { setOpenLiquidateConfirm(false); setSelectedPosition(null); setLiquidateError(''); }}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#111820', color: 'white' } }}
      >
        <DialogTitle sx={{ pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Gavel sx={{ color: '#ef4444' }} />
          Confirm Liquidation
        </DialogTitle>
        <DialogContent>
          {selectedPosition && (() => {
            const threshold = getThreshold(selectedPosition.fund);
            const pnl = selectedPosition.unrealizedPnL || 0;
            const amountOwed = pnl < 0 ? Math.min(Math.abs(pnl), selectedPosition.collateralValue) : 0;
            return (
              <Box>
                <Box sx={{ bgcolor: 'rgba(239,68,68,0.08)', borderRadius: '8px', p: 2, mb: 2, border: '1px solid rgba(239,68,68,0.2)' }}>
                  <Typography sx={{ fontSize: 13, color: '#ef4444' }}>
                    This will seize collateral from the fund's escrow and mark the position as Liquidated. This action cannot be undone.
                  </Typography>
                </Box>

                <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 2.5 }}>
                  {[
                    { label: 'Position', value: selectedPosition.positionId },
                    { label: 'Fund', value: selectedPosition.fund.split('::')[0] },
                    { label: 'Status', value: selectedPosition.status, color: '#ef4444' },
                    { label: 'Current LTV', value: `${(selectedPosition.currentLTV * 100).toFixed(1)}%`, color: '#ef4444' },
                    { label: 'LTV Threshold', value: `${(threshold * 100).toFixed(0)}%`, color: '#f59e0b' },
                    { label: 'Notional Value', value: `$${selectedPosition.notionalValue.toLocaleString()}` },
                    { label: 'Collateral Value', value: selectedPosition.collateralValue ? `$${selectedPosition.collateralValue.toLocaleString()}` : 'Encrypted', color: selectedPosition.collateralValue ? undefined : 'rgba(255,255,255,0.25)' },
                    { label: 'Unrealized PnL', value: `${pnl >= 0 ? '+' : ''}$${pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, color: pnl >= 0 ? '#00d4aa' : '#ef4444' },
                    ...(selectedPosition.collateralValue ? [{ label: 'Amount Owed (Loss)', value: `$${amountOwed.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, color: '#ef4444' }] : []),
                  ].map(row => (
                    <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.8, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{row.label}</Typography>
                      <Typography sx={{ fontSize: 13, fontWeight: 600, color: row.color || 'white' }}>{row.value}</Typography>
                    </Box>
                  ))}
                </Box>

                {liquidateError && (
                  <Box sx={{ mt: 2, p: 1.5, bgcolor: 'rgba(239,68,68,0.1)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)' }}>
                    <Typography sx={{ fontSize: 12, color: '#ef4444' }}>{liquidateError}</Typography>
                  </Box>
                )}
              </Box>
            );
          })()}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => { setOpenLiquidateConfirm(false); setSelectedPosition(null); setLiquidateError(''); }}
            sx={{ color: 'rgba(255,255,255,0.5)' }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleLiquidateConfirm}
            disabled={!!liquidating}
            sx={{
              bgcolor: '#ef4444',
              color: 'white',
              fontWeight: 600,
              textTransform: 'none',
              '&:hover': { bgcolor: '#dc2626' },
            }}
          >
            {liquidating ? 'Liquidating...' : 'Confirm Liquidation'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Position Detail Dialog */}
      <PositionDetailDialog
        position={detailPosition}
        ltvThreshold={detailPosition ? getThreshold(detailPosition.fund) : 0.8}
        onClose={() => setDetailPosition(null)}
      />
    </Box>
  );
}

export default function Positions({ user, assets }: PositionsProps) {
  const { isPrimeBroker } = useRole();
  void assets;

  if (isPrimeBroker) {
    return <BrokerPositions user={user} />;
  }

  return <FundPositions user={user} />;
}
