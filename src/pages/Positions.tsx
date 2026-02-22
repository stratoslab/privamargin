import { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Chip, Grid, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Stepper, Step, StepLabel
} from '@mui/material';
import { Add, TrendingUp, Close, ArrowBack, ArrowForward, Warning, Gavel } from '@mui/icons-material';
import { positionAPI, linkAPI, vaultAPI, getLivePrice } from '../services/api';
import type { PositionData, BrokerFundLinkData } from '../services/api';
import { useRole } from '../context/RoleContext';
import type { AuthUser, Asset } from '@stratos-wallet/sdk';

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

const STEP_LABELS = ['Select Broker', 'Select Asset', 'Enter Units', 'Select Vault', 'Confirm'];

// Fund View
function FundPositions({ user }: { user: AuthUser }) {
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [links, setLinks] = useState<BrokerFundLinkData[]>([]);
  const [vaults, setVaults] = useState<any[]>([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);

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
  const ltvPreview = selectedVault && selectedVault.totalValue > 0 ? notionalValue / selectedVault.totalValue : 0;

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

      await positionAPI.create(
        partyId,
        form.broker,
        operator,
        form.vaultId,
        description,
        notionalValue,
        form.direction,
        livePrice || 0,
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

  const handleClose = async (contractId: string) => {
    setClosing(contractId);
    try {
      await positionAPI.close(contractId);
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

      {/* Position List */}
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
        <Grid container spacing={2}>
          {positions.map((pos) => {
            const threshold = getThreshold(pos.broker);
            const ltvColor = getLTVColor(pos.currentLTV, threshold);
            return (
              <Grid item xs={12} md={6} key={pos.contractId}>
                <Box
                  sx={{
                    bgcolor: '#111820',
                    borderRadius: '12px',
                    border: `1px solid ${pos.status === 'MarginCalled' ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.06)'}`,
                    p: 2.5,
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'white' }}>
                          {pos.positionId}
                        </Typography>
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
                      </Box>
                      <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                        {pos.description || 'No description'}
                      </Typography>
                    </Box>
                    <Chip
                      label={pos.status}
                      size="small"
                      sx={{
                        bgcolor: pos.status === 'Open' ? 'rgba(0,212,170,0.2)' :
                                 pos.status === 'MarginCalled' ? 'rgba(239,68,68,0.2)' :
                                 pos.status === 'Liquidated' ? 'rgba(239,68,68,0.2)' :
                                 'rgba(255,255,255,0.1)',
                        color: pos.status === 'Open' ? '#00d4aa' :
                               pos.status === 'MarginCalled' ? '#ef4444' :
                               pos.status === 'Liquidated' ? '#ef4444' :
                               'rgba(255,255,255,0.5)',
                        fontWeight: 600,
                        fontSize: 11,
                      }}
                    />
                  </Box>

                  <Grid container spacing={2} sx={{ mb: 1.5 }}>
                    <Grid item xs={3}>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Notional</Typography>
                      <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'white' }}>
                        ${pos.notionalValue.toLocaleString()}
                      </Typography>
                    </Grid>
                    <Grid item xs={3}>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Collateral</Typography>
                      <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'white' }}>
                        ${pos.collateralValue.toLocaleString()}
                      </Typography>
                    </Grid>
                    <Grid item xs={3}>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>PnL</Typography>
                      <Typography sx={{
                        fontSize: 14, fontWeight: 600,
                        color: pos.unrealizedPnL >= 0 ? '#00d4aa' : '#ef4444',
                      }}>
                        {pos.unrealizedPnL >= 0 ? '+' : ''}{pos.unrealizedPnL !== 0 ? `$${pos.unrealizedPnL.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '$0'}
                      </Typography>
                    </Grid>
                    <Grid item xs={3}>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>LTV</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography sx={{ fontSize: 14, fontWeight: 600, color: ltvColor }}>
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
                    </Grid>
                  </Grid>

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                      Vault: {pos.vaultId} &middot; Broker: {pos.broker.split('::')[0]}
                    </Typography>
                    {pos.status === 'Open' && (
                      <Button
                        size="small"
                        startIcon={<Close />}
                        onClick={() => handleClose(pos.contractId)}
                        disabled={closing === pos.contractId}
                        sx={{ color: 'rgba(255,255,255,0.4)', textTransform: 'none', fontSize: 12 }}
                      >
                        Close
                      </Button>
                    )}
                  </Box>
                </Box>
              </Grid>
            );
          })}
        </Grid>
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
                  const projectedLTV = v.totalValue > 0 ? notionalValue / v.totalValue : 0;
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
    setLiquidating(selectedPosition.contractId);
    setLiquidateError('');
    try {
      await positionAPI.liquidate(selectedPosition.contractId);
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
        <Grid container spacing={2}>
          {filteredPositions.map((pos) => {
            const threshold = getThreshold(pos.fund);
            const ltvColor = getLTVColor(pos.currentLTV, threshold);
            const approaching = pos.currentLTV >= threshold * 0.9;
            const canLiquidate = (pos.status === 'Open' || pos.status === 'MarginCalled') && pos.currentLTV >= threshold;
            return (
              <Grid item xs={12} md={6} key={pos.contractId}>
                <Box
                  sx={{
                    bgcolor: '#111820',
                    borderRadius: '12px',
                    border: `1px solid ${approaching ? `${ltvColor}40` : 'rgba(255,255,255,0.06)'}`,
                    p: 2.5,
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
                    <Box>
                      <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'white' }}>
                        {pos.positionId}
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                        Fund: {pos.fund.split('::')[0]}
                      </Typography>
                    </Box>
                    <Chip
                      label={pos.status}
                      size="small"
                      sx={{
                        bgcolor: pos.status === 'Open' ? 'rgba(0,212,170,0.2)' :
                                 pos.status === 'MarginCalled' ? 'rgba(239,68,68,0.2)' :
                                 pos.status === 'Liquidated' ? 'rgba(239,68,68,0.2)' :
                                 'rgba(255,255,255,0.1)',
                        color: pos.status === 'Open' ? '#00d4aa' :
                               pos.status === 'MarginCalled' ? '#ef4444' :
                               pos.status === 'Liquidated' ? '#ef4444' :
                               'rgba(255,255,255,0.5)',
                        fontWeight: 600,
                        fontSize: 11,
                      }}
                    />
                  </Box>

                  <Grid container spacing={2} sx={{ mb: 1 }}>
                    <Grid item xs={4}>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Notional</Typography>
                      <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'white' }}>
                        ${pos.notionalValue.toLocaleString()}
                      </Typography>
                    </Grid>
                    <Grid item xs={4}>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Collateral</Typography>
                      <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'white' }}>
                        ${pos.collateralValue.toLocaleString()}
                      </Typography>
                    </Grid>
                    <Grid item xs={4}>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>LTV</Typography>
                      <Typography sx={{ fontSize: 16, fontWeight: 700, color: ltvColor }}>
                        {(pos.currentLTV * 100).toFixed(1)}%
                      </Typography>
                    </Grid>
                  </Grid>

                  {/* LTV bar */}
                  <Box sx={{ mt: 1, mb: 0.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                      <Typography sx={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>0%</Typography>
                      <Typography sx={{ fontSize: 10, color: '#f59e0b' }}>Threshold: {(threshold * 100).toFixed(0)}%</Typography>
                      <Typography sx={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>100%</Typography>
                    </Box>
                    <Box sx={{ width: '100%', height: 6, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 3, position: 'relative' }}>
                      <Box
                        sx={{
                          width: `${Math.min(pos.currentLTV * 100, 100)}%`,
                          height: '100%',
                          bgcolor: ltvColor,
                          borderRadius: 3,
                        }}
                      />
                      <Box
                        sx={{
                          position: 'absolute',
                          left: `${threshold * 100}%`,
                          top: -2,
                          width: 2,
                          height: 10,
                          bgcolor: '#f59e0b',
                          borderRadius: 1,
                        }}
                      />
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
                    <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                      Vault: {pos.vaultId}
                    </Typography>
                    {canLiquidate && (
                      <Button
                        size="small"
                        startIcon={<Gavel />}
                        onClick={() => handleLiquidateClick(pos)}
                        disabled={liquidating === pos.contractId}
                        sx={{
                          color: '#ef4444',
                          bgcolor: 'rgba(239,68,68,0.1)',
                          textTransform: 'none',
                          fontSize: 12,
                          fontWeight: 600,
                          px: 1.5,
                          '&:hover': { bgcolor: 'rgba(239,68,68,0.2)' },
                        }}
                      >
                        {liquidating === pos.contractId ? 'Liquidating...' : 'Liquidate'}
                      </Button>
                    )}
                  </Box>
                </Box>
              </Grid>
            );
          })}
        </Grid>
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
            const liquidationAmount = Math.min(selectedPosition.notionalValue, selectedPosition.collateralValue);
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
                    { label: 'Collateral Value', value: `$${selectedPosition.collateralValue.toLocaleString()}` },
                    { label: 'Liquidation Amount', value: `$${liquidationAmount.toLocaleString()}`, color: '#ef4444' },
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
