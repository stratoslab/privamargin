import { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, TextField, Button, Alert, Paper,
  MenuItem, Select, FormControl, InputLabel, Grid, Slider, IconButton,
} from '@mui/material';
import { Lock, VerifiedUser, Delete } from '@mui/icons-material';
import { marginAPI, vaultAPI } from '../services/api';
import { useRole } from '../context/RoleContext';
import type { AuthUser } from '@stratos-wallet/sdk';

interface MarginVerificationProps {
  user: AuthUser;
}

// Shared threshold slider marks
const thresholdMarks = [
  { value: 50, label: '50%' },
  { value: 65, label: '65%' },
  { value: 80, label: '80%' },
  { value: 95, label: '95%' },
];

// Shared threshold slider sx
const thresholdSliderSx = {
  color: '#8b5cf6',
  '& .MuiSlider-markLabel': { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
};

// Helper: LTV color based on dynamic threshold
function getLTVColor(ltv: number, threshold: number): string {
  if (ltv >= threshold) return '#ef4444';
  if (ltv >= threshold * 0.75) return '#f59e0b';
  return '#10b981';
}

// Shared ZK proof display panel
function ZKProofPanel({ zkProof, variant }: { zkProof: any; variant: 'fund' | 'broker' }) {
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const { verifyLTVProof } = await import('../services/zkProof');
      const valid = await verifyLTVProof(zkProof.proof, zkProof.publicSignals);
      setVerifyResult(valid);
    } catch {
      setVerifyResult(false);
    } finally {
      setVerifying(false);
    }
  };

  const isFund = variant === 'fund';
  const thresholdBps = zkProof.publicSignals?.[3];

  return (
    <Paper sx={{
      p: 2, mb: 2,
      bgcolor: isFund ? 'rgba(16,185,129,0.08)' : 'rgba(139,92,246,0.08)',
      border: `1px solid ${isFund ? 'rgba(16,185,129,0.2)' : 'rgba(139,92,246,0.2)'}`,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <VerifiedUser fontSize="small" sx={{ mr: 1, color: isFund ? '#10b981' : '#8b5cf6' }} />
        <Typography variant="subtitle2" sx={{ color: isFund ? '#10b981' : '#8b5cf6' }}>
          Groth16 ZK Proof {zkProof.verified ? '(Self-Verified)' : ''}
        </Typography>
      </Box>

      <Typography variant="body2" sx={{
        fontFamily: 'monospace', fontSize: 11,
        color: 'rgba(255,255,255,0.5)', wordBreak: 'break-all', mb: 1
      }}>
        {zkProof.proofHash}
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
        <Typography variant="caption" color="textSecondary">
          LTV: {zkProof.publicSignals[0]} bps ({(parseInt(zkProof.publicSignals[0]) / 100).toFixed(2)}%)
        </Typography>
        {thresholdBps && (
          <Typography variant="caption" color="textSecondary">
            Threshold: {thresholdBps} bps ({(parseInt(thresholdBps) / 100).toFixed(0)}%)
          </Typography>
        )}
        <Typography variant="caption" sx={{
          fontWeight: 700,
          color: zkProof.isLiquidatable ? '#ef4444' : '#10b981'
        }}>
          {zkProof.isLiquidatable ? 'LIQUIDATABLE' : 'SAFE'}
        </Typography>
        <Typography variant="caption" color="textSecondary">
          Proof time: {zkProof.proofTimeMs}ms
        </Typography>
      </Box>

      {variant === 'broker' && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={handleVerify}
            disabled={verifying}
            sx={{ color: '#8b5cf6', borderColor: '#8b5cf6', fontSize: 11 }}
          >
            {verifying ? 'Verifying...' : 'Verify Proof Independently'}
          </Button>
          {verifyResult !== null && (
            <Typography variant="caption" sx={{
              fontWeight: 700,
              color: verifyResult ? '#10b981' : '#ef4444'
            }}>
              {verifyResult ? 'VALID' : 'INVALID'}
            </Typography>
          )}
        </Box>
      )}
    </Paper>
  );
}

// Fund view — full verification form with ZK proof generation
function FundMarginVerification({ user }: MarginVerificationProps) {
  const [vaults, setVaults] = useState<any[]>([]);
  const [form, setForm] = useState({
    vaultId: '',
    requiredMargin: ''
  });
  const [threshold, setThreshold] = useState(80);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadVaults();
  }, [user]);

  const loadVaults = async () => {
    try {
      const res = await vaultAPI.getByOwner(user.partyId || user.id);
      setVaults(res.data);
    } catch (error) {
      console.error('Error loading vaults:', error);
    }
  };

  const thresholdFrac = threshold / 100;

  const handleVerify = async () => {
    setLoading(true);
    setResult(null);

    try {
      const vaultRes = await vaultAPI.getVault(form.vaultId);
      const vault = vaultRes.data;
      const collateralValue = vault.totalValue;

      // Extract individual asset values for ZK proof (private witness)
      const assetValues = (vault.collateralAssets || []).map((a: any) => a.valueUSD || 0);

      const res = await marginAPI.verify(
        form.vaultId,
        parseFloat(form.requiredMargin),
        collateralValue,
        thresholdFrac,
        assetValues,
      );

      setResult(res.data);
    } catch (error) {
      console.error('Error verifying margin:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Margin Verification
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        <strong>Privacy-Preserving Verification:</strong> A Groth16 ZK-SNARK proves
        your LTV ratio is correct without revealing individual asset values to the counterparty.
      </Alert>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Compute LTV
              </Typography>

              <FormControl fullWidth margin="normal">
                <InputLabel>Vault</InputLabel>
                <Select
                  value={form.vaultId}
                  label="Vault"
                  onChange={(e) => setForm({ ...form, vaultId: e.target.value })}
                >
                  {vaults.map((vault) => (
                    <MenuItem key={vault.vaultId} value={vault.vaultId}>
                      {vault.vaultId} (${vault.totalValue.toLocaleString()})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                fullWidth
                margin="normal"
                label="Notional Value (USD)"
                type="number"
                value={form.requiredMargin}
                onChange={(e) => setForm({ ...form, requiredMargin: e.target.value })}
              />

              <Box sx={{ mt: 2, mb: 1, px: 1 }}>
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)', mb: 1 }}>
                  Liquidation Threshold: {threshold}%
                </Typography>
                <Slider
                  value={threshold}
                  onChange={(_, val) => setThreshold(val as number)}
                  min={50}
                  max={95}
                  step={5}
                  marks={thresholdMarks}
                  sx={thresholdSliderSx}
                />
              </Box>

              <Button
                fullWidth
                variant="contained"
                sx={{ mt: 2 }}
                onClick={handleVerify}
                disabled={loading || !form.vaultId || !form.requiredMargin}
              >
                {loading ? 'Generating ZK Proof...' : 'Verify LTV'}
              </Button>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Verification Result
              </Typography>

              {result ? (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Box sx={{
                      width: 64, height: 64, borderRadius: '50%', mr: 2,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      bgcolor: `${getLTVColor(result.ltv, thresholdFrac)}26`,
                      border: `2px solid ${getLTVColor(result.ltv, thresholdFrac)}`
                    }}>
                      <Typography variant="h6" sx={{
                        fontWeight: 700, fontFamily: 'monospace',
                        color: getLTVColor(result.ltv, thresholdFrac)
                      }}>
                        {(result.ltv * 100).toFixed(1)}%
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="h5" sx={{
                        fontWeight: 700,
                        color: getLTVColor(result.ltv, thresholdFrac)
                      }}>
                        LTV: {result.ltv.toFixed(4)}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        Vault: {form.vaultId}
                      </Typography>
                    </Box>
                  </Box>

                  {/* LTV bar */}
                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="caption" color="textSecondary">0%</Typography>
                      <Typography variant="caption" color="textSecondary">{threshold}%</Typography>
                      <Typography variant="caption" color="textSecondary">100%</Typography>
                    </Box>
                    <Box sx={{ position: 'relative', height: 8, bgcolor: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
                      <Box sx={{
                        position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 4,
                        width: `${Math.min(result.ltv * 100, 100)}%`,
                        bgcolor: getLTVColor(result.ltv, thresholdFrac),
                        transition: 'width 0.5s ease'
                      }} />
                    </Box>
                  </Box>

                  {/* ZK Proof panel */}
                  {result.zkProof ? (
                    <ZKProofPanel zkProof={result.zkProof} variant="fund" />
                  ) : (
                    <Paper sx={{ p: 2, bgcolor: 'rgba(139, 92, 246, 0.1)', mb: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <Lock fontSize="small" sx={{ mr: 1, color: '#8b5cf6' }} />
                        <Typography variant="subtitle2">
                          Privacy Protected
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="textSecondary">
                        ZK proof artifacts not available. LTV computed without cryptographic proof.
                      </Typography>
                    </Paper>
                  )}

                  <Typography variant="caption" color="textSecondary">
                    Verified at: {new Date(result.timestamp).toLocaleString()}
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography color="textSecondary">
                    No verification performed yet
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                How It Works
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <Box sx={{ textAlign: 'center', p: 2 }}>
                    <Box sx={{
                      width: 48, height: 48, borderRadius: '50%', bgcolor: '#8b5cf6',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      margin: '0 auto', mb: 1, color: 'white', fontWeight: 700
                    }}>1</Box>
                    <Typography variant="h6" color="primary">Submit</Typography>
                    <Typography variant="body2" color="textSecondary">
                      Fund selects vault and enters notional value
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Box sx={{ textAlign: 'center', p: 2 }}>
                    <Box sx={{
                      width: 48, height: 48, borderRadius: '50%', bgcolor: '#06b6d4',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      margin: '0 auto', mb: 1, color: 'white', fontWeight: 700
                    }}>2</Box>
                    <Typography variant="h6" sx={{ color: '#06b6d4' }}>Prove</Typography>
                    <Typography variant="body2" color="textSecondary">
                      Groth16 ZK-SNARK proves LTV without revealing asset values
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Box sx={{ textAlign: 'center', p: 2 }}>
                    <Box sx={{
                      width: 48, height: 48, borderRadius: '50%', bgcolor: '#10b981',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      margin: '0 auto', mb: 1, color: 'white', fontWeight: 700
                    }}>3</Box>
                    <Typography variant="h6" sx={{ color: '#10b981' }}>Verify</Typography>
                    <Typography variant="body2" color="textSecondary">
                      Broker independently verifies the proof — sees LTV, not collateral
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

// Broker view — LTV sandbox with mock vault for ZK proof exploration
function BrokerMarginVerification({ user }: MarginVerificationProps) {
  const [mockAssets, setMockAssets] = useState<Array<{ symbol: string; amount: number; price: number }>>([]);
  const [notional, setNotional] = useState('');
  const [threshold, setThreshold] = useState(80);
  const [newAsset, setNewAsset] = useState({ symbol: 'USDC', amount: '', price: '' });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  void user;

  const assetSymbols = ['USDC', 'ETH', 'BTC', 'CC'];

  const addAsset = () => {
    const amount = parseFloat(newAsset.amount);
    const price = parseFloat(newAsset.price);
    if (!amount || !price) return;
    setMockAssets([...mockAssets, { symbol: newAsset.symbol, amount, price }]);
    setNewAsset({ symbol: newAsset.symbol, amount: '', price: '' });
  };

  const removeAsset = (index: number) => {
    setMockAssets(mockAssets.filter((_, i) => i !== index));
  };

  const totalCollateral = mockAssets.reduce((sum, a) => sum + a.amount * a.price, 0);
  const thresholdFrac = threshold / 100;

  const handleGenerateProof = async () => {
    setLoading(true);
    setResult(null);

    try {
      const assetValues = mockAssets.map(a => a.amount * a.price);
      const notionalValue = parseFloat(notional);

      const res = await marginAPI.verify(
        'mock-vault',
        notionalValue,
        totalCollateral,
        thresholdFrac,
        assetValues,
      );

      setResult(res.data);
    } catch (error) {
      console.error('Error generating proof:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Margin Verification
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }} icon={<Lock />}>
        <strong>Broker Sandbox:</strong> Create a mock vault with arbitrary assets to explore
        how the ZK-SNARK LTV computation and proof generation work.
      </Alert>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                LTV Sandbox
              </Typography>

              {/* Mock asset list */}
              {mockAssets.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  {mockAssets.map((asset, i) => (
                    <Box key={i} sx={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      p: 1, mb: 0.5, borderRadius: 1,
                      bgcolor: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.15)',
                    }}>
                      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 48 }}>
                          {asset.symbol}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {asset.amount} @ ${asset.price.toLocaleString()}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          ${(asset.amount * asset.price).toLocaleString()}
                        </Typography>
                        <IconButton size="small" onClick={() => removeAsset(i)} sx={{ color: 'rgba(255,255,255,0.3)' }}>
                          <Delete fontSize="small" />
                        </IconButton>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}

              {/* Add asset row */}
              <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'flex-end' }}>
                <FormControl size="small" sx={{ minWidth: 90 }}>
                  <InputLabel>Symbol</InputLabel>
                  <Select
                    value={newAsset.symbol}
                    label="Symbol"
                    onChange={(e) => setNewAsset({ ...newAsset, symbol: e.target.value })}
                  >
                    {assetSymbols.map((s) => (
                      <MenuItem key={s} value={s}>{s}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  size="small"
                  label="Amount"
                  type="number"
                  value={newAsset.amount}
                  onChange={(e) => setNewAsset({ ...newAsset, amount: e.target.value })}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  label="Price"
                  type="number"
                  value={newAsset.price}
                  onChange={(e) => setNewAsset({ ...newAsset, price: e.target.value })}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={addAsset}
                  disabled={!newAsset.amount || !newAsset.price}
                  sx={{ color: '#8b5cf6', borderColor: '#8b5cf6', minWidth: 64 }}
                >
                  Add
                </Button>
              </Box>

              {/* Total collateral */}
              <Box sx={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                p: 1.5, mb: 2, borderRadius: 1,
                bgcolor: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)',
              }}>
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)' }}>
                  Total Collateral
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 700, fontFamily: 'monospace', color: '#10b981' }}>
                  ${totalCollateral.toLocaleString()}
                </Typography>
              </Box>

              <TextField
                fullWidth
                margin="normal"
                label="Notional Value (USD)"
                type="number"
                value={notional}
                onChange={(e) => setNotional(e.target.value)}
              />

              <Box sx={{ mt: 2, mb: 1, px: 1 }}>
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)', mb: 1 }}>
                  Liquidation Threshold: {threshold}%
                </Typography>
                <Slider
                  value={threshold}
                  onChange={(_, val) => setThreshold(val as number)}
                  min={50}
                  max={95}
                  step={5}
                  marks={thresholdMarks}
                  sx={thresholdSliderSx}
                />
              </Box>

              <Button
                fullWidth
                variant="contained"
                sx={{ mt: 2, bgcolor: '#8b5cf6', '&:hover': { bgcolor: '#7c3aed' } }}
                onClick={handleGenerateProof}
                disabled={loading || mockAssets.length === 0 || !notional}
              >
                {loading ? 'Generating ZK Proof...' : 'Generate ZK Proof'}
              </Button>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Verification Result
              </Typography>

              {result ? (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Box sx={{
                      width: 64, height: 64, borderRadius: '50%', mr: 2,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      bgcolor: `${getLTVColor(result.ltv, thresholdFrac)}26`,
                      border: `2px solid ${getLTVColor(result.ltv, thresholdFrac)}`
                    }}>
                      <Typography variant="h6" sx={{
                        fontWeight: 700, fontFamily: 'monospace',
                        color: getLTVColor(result.ltv, thresholdFrac)
                      }}>
                        {(result.ltv * 100).toFixed(1)}%
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="h5" sx={{
                        fontWeight: 700,
                        color: getLTVColor(result.ltv, thresholdFrac)
                      }}>
                        LTV: {result.ltv.toFixed(4)}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        Mock Vault ({mockAssets.length} asset{mockAssets.length !== 1 ? 's' : ''})
                      </Typography>
                    </Box>
                  </Box>

                  {/* LTV bar */}
                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="caption" color="textSecondary">0%</Typography>
                      <Typography variant="caption" color="textSecondary">{threshold}%</Typography>
                      <Typography variant="caption" color="textSecondary">100%</Typography>
                    </Box>
                    <Box sx={{ position: 'relative', height: 8, bgcolor: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
                      <Box sx={{
                        position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 4,
                        width: `${Math.min(result.ltv * 100, 100)}%`,
                        bgcolor: getLTVColor(result.ltv, thresholdFrac),
                        transition: 'width 0.5s ease'
                      }} />
                    </Box>
                  </Box>

                  {/* ZK Proof panel with verify button */}
                  {result.zkProof ? (
                    <ZKProofPanel zkProof={result.zkProof} variant="broker" />
                  ) : (
                    <Paper sx={{ p: 2, bgcolor: 'rgba(139, 92, 246, 0.1)', mb: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <Lock fontSize="small" sx={{ mr: 1, color: '#8b5cf6' }} />
                        <Typography variant="subtitle2">
                          Collateral Value Hidden
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="textSecondary">
                        No ZK proof available. LTV computed without cryptographic verification.
                      </Typography>
                    </Paper>
                  )}

                  <Typography variant="caption" color="textSecondary">
                    Verified at: {new Date(result.timestamp).toLocaleString()}
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <VerifiedUser sx={{ fontSize: 48, color: 'rgba(255,255,255,0.1)', mb: 1 }} />
                  <Typography color="textSecondary">
                    Add assets to the mock vault and generate a ZK proof to see results
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

export default function MarginVerification({ user }: MarginVerificationProps) {
  const { isPrimeBroker } = useRole();

  if (isPrimeBroker) {
    return <BrokerMarginVerification user={user} />;
  }

  return <FundMarginVerification user={user} />;
}
