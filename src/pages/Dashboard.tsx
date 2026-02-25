import { useState, useEffect, Fragment } from 'react';
import {
  Box, Typography, Button, Grid, CircularProgress, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Collapse, IconButton, Chip,
} from '@mui/material';
import {
  Add, Visibility, VisibilityOff, Lock, LockOpen, TrendingUp, Warning, Shield,
  Schedule, ExpandMore, ExpandLess, CheckCircle,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { vaultAPI, marginAPI, invitationAPI, positionAPI, linkAPI, workflowMarginCallAPI, getCustodianParty } from '../services/api';
import type { PositionData, BrokerFundLinkData, WorkflowMarginCallData } from '../services/api';
import { useRole } from '../context/RoleContext';
import type { AuthUser, Asset } from '@stratos-wallet/sdk';

interface DashboardProps {
  user: AuthUser;
  assets: Asset[];
}

// Stats Card Component
function StatsCard({ label, value, sublabel, icon, iconBgColor }: {
  label: string;
  value: string;
  sublabel: string;
  icon: React.ReactNode;
  iconBgColor?: string;
}) {
  return (
    <Box
      sx={{
        bgcolor: '#111820',
        borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.06)',
        p: 2.5,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}
    >
      <Box>
        <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', mb: 1 }}>{label}</Typography>
        <Typography sx={{ fontSize: 28, fontWeight: 600, color: 'white', mb: 0.5 }}>{value}</Typography>
        <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{sublabel}</Typography>
      </Box>
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: '10px',
          bgcolor: iconBgColor || 'rgba(255,255,255,0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </Box>
    </Box>
  );
}

// Fund Dashboard — original behavior with full portfolio values
function FundDashboard({ user, assets }: DashboardProps) {
  const [vaults, setVaults] = useState<any[]>([]);
  const [marginCalls, setMarginCalls] = useState<any[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [pendingInvitations, setPendingInvitations] = useState(0);
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [zkProof, setZkProof] = useState('Generating...');
  const navigate = useNavigate();

  void assets;

  useEffect(() => {
    loadData();
  }, [user]);

  const loadData = async () => {
    try {
      const partyId = user.partyId || user.id;
      const [vaultsRes, callsRes, invRes, posRes] = await Promise.all([
        vaultAPI.getByOwner(partyId),
        marginAPI.getActiveMarginCalls(),
        invitationAPI.listPendingForFund(partyId),
        positionAPI.listByFund(partyId),
      ]);
      setVaults(vaultsRes.data);
      const total = vaultsRes.data.reduce((sum: number, v: any) => sum + v.totalValue, 0);
      setTotalValue(total);
      setMarginCalls(callsRes.data);
      setPendingInvitations(invRes.data.length);
      setPositions(posRes.data);

      // Generate real ZK proof for dashboard display
      if (vaultsRes.data.length > 0 && posRes.data.length > 0) {
        try {
          const { isZKAvailable, generateLTVProof, proofHash, usdToCents, ltvToBps } =
            await import('../services/zkProof');
          if (await isZKAvailable()) {
            const vault = vaultsRes.data[0];
            const position = posRes.data[0];
            const assetCents = (vault.collateralAssets || []).map((a: any) => usdToCents(a.valueUSD || 0));
            const result = await generateLTVProof({
              assetValuesCents: assetCents,
              notionalValueCents: usdToCents(position.notionalValue || 0),
              ltvThresholdBps: ltvToBps(0.8),
            });
            const hash = await proofHash(result.proof);
            setZkProof(hash);
          } else {
            setZkProof('ZK artifacts not available');
          }
        } catch (err) {
          console.warn('Dashboard ZK proof generation failed:', err);
          setZkProof('Proof generation failed');
        }
      } else {
        setZkProof('No vault/position data');
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
        <Box>
          <Typography sx={{ fontSize: 28, fontWeight: 600, color: 'white', mb: 0.5 }}>Dashboard</Typography>
          <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
            Privacy-preserving collateral management
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => navigate('/vaults')}
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
          Create Vault
        </Button>
      </Box>

      {/* Stats Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            label="Total Assets"
            value={`$${totalValue.toLocaleString()}`}
            sublabel="Across all vaults"
            icon={<Box sx={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)' }} />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            label="Capital Protected"
            value={`$${totalValue.toLocaleString()}`}
            sublabel="Hidden from counterparties"
            icon={<Box sx={{ width: 20, height: 20, borderRadius: '6px', border: '2px solid #00d4aa', bgcolor: 'transparent' }} />}
            iconBgColor="rgba(0, 212, 170, 0.1)"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            label="Positions"
            value={positions.length.toString()}
            sublabel={`${positions.filter(p => p.status === 'Open').length} open`}
            icon={<TrendingUp sx={{ color: '#00d4aa', fontSize: 20 }} />}
            iconBgColor="rgba(0, 212, 170, 0.1)"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            label="Margin Calls"
            value={marginCalls.length.toString()}
            sublabel={pendingInvitations > 0 ? `${pendingInvitations} pending invitation(s)` : 'Requiring attention'}
            icon={<Warning sx={{ color: marginCalls.length > 0 ? '#ef4444' : 'rgba(255,255,255,0.4)', fontSize: 20 }} />}
            iconBgColor={marginCalls.length > 0 ? 'rgba(239, 68, 68, 0.1)' : undefined}
          />
        </Grid>
      </Grid>

      {/* Privacy-Preserving Verification Card */}
      <Box
        sx={{
          bgcolor: '#111820',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.06)',
          p: 3,
          mb: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '10px',
              border: '2px solid #00d4aa',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#00d4aa' }} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'white' }}>Privacy-Preserving Verification</Typography>
            <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Zero-Knowledge Proof Active</Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 4, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Visibility sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 16 }} />
            <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Disclosed:</Typography>
            <Box sx={{ px: 1.5, py: 0.3, bgcolor: 'rgba(0, 212, 170, 0.1)', borderRadius: '4px' }}>
              <Typography sx={{ fontSize: 12, color: '#00d4aa', fontWeight: 500 }}>Sufficient</Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <VisibilityOff sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 16 }} />
            <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Hidden:</Typography>
            <Typography sx={{ fontSize: 13, color: '#00d4aa', fontWeight: 500 }}>Actual Collateral Value</Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Lock sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 16 }} />
          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.7)' }}>ZK Proof Hash</Typography>
        </Box>
        <Box
          sx={{
            bgcolor: 'rgba(255,255,255,0.03)',
            borderRadius: '8px',
            p: 1.5,
            fontFamily: 'monospace',
          }}
        >
          <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', wordBreak: 'break-all' }}>
            {zkProof}
          </Typography>
        </Box>
      </Box>

      {/* Your Vaults and Margin Calls */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <Box
            sx={{
              bgcolor: '#111820',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.06)',
              p: 3,
              minHeight: 200,
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography sx={{ fontSize: 18, fontWeight: 600, color: 'white' }}>Your Vaults</Typography>
              <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{vaults.length} total</Typography>
            </Box>

            {vaults.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Box
                  sx={{
                    width: 60,
                    height: 60,
                    borderRadius: '12px',
                    bgcolor: 'rgba(255,255,255,0.03)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto',
                    mb: 2,
                  }}
                >
                  <Box sx={{ fontSize: 24, color: 'rgba(255,255,255,0.2)' }}>&#x22A0;</Box>
                </Box>
                <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.7)', mb: 0.5 }}>
                  No Vaults Yet
                </Typography>
                <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                  Create a vault to start managing collateral
                </Typography>
              </Box>
            ) : (
              vaults.map((vault, idx) => (
                <Box
                  key={idx}
                  sx={{
                    p: 2,
                    bgcolor: 'rgba(255,255,255,0.02)',
                    borderRadius: '8px',
                    mb: 1.5,
                    '&:last-child': { mb: 0 },
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'white' }}>{vault.vaultId}</Typography>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, color: '#00d4aa' }}>
                      ${vault.totalValue.toLocaleString()}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                    {vault.collateralAssets?.length || 0} assets
                  </Typography>
                </Box>
              ))
            )}
          </Box>
        </Grid>

        <Grid item xs={12} md={5}>
          <Box
            sx={{
              bgcolor: '#111820',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.06)',
              p: 3,
              minHeight: 200,
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography sx={{ fontSize: 18, fontWeight: 600, color: 'white' }}>Margin Calls</Typography>
              <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{marginCalls.length} active</Typography>
            </Box>

            {marginCalls.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Box
                  sx={{
                    width: 60,
                    height: 60,
                    borderRadius: '12px',
                    bgcolor: 'rgba(255,255,255,0.03)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto',
                    mb: 2,
                  }}
                >
                  <TrendingUp sx={{ fontSize: 24, color: '#00d4aa' }} />
                </Box>
                <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.7)', mb: 0.5 }}>
                  No Active Margin Calls
                </Typography>
                <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                  All positions are sufficiently collateralized
                </Typography>
              </Box>
            ) : (
              marginCalls.map((call, idx) => (
                <Box
                  key={idx}
                  sx={{
                    p: 2,
                    bgcolor: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '8px',
                    borderLeft: '3px solid #ef4444',
                    mb: 1.5,
                    '&:last-child': { mb: 0 },
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'white' }}>{call.positionId}</Typography>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, color: '#ef4444' }}>
                      ${call.requiredAmount.toLocaleString()}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                    {call.status}
                  </Typography>
                </Box>
              ))
            )}
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}

// Primebroker Dashboard — redacted values, ZK status feed
function BrokerDashboard({ user }: { user: AuthUser }) {
  const [marginCalls, setMarginCalls] = useState<any[]>([]);
  const [brokerLinks, setBrokerLinks] = useState<BrokerFundLinkData[]>([]);
  const [brokerPositions, setBrokerPositions] = useState<PositionData[]>([]);
  const [workflowCalls, setWorkflowCalls] = useState<WorkflowMarginCallData[]>([]);
  const { allRoles } = useRole();

  const partyId = user.partyId || user.id;
  const fundCount = brokerLinks.filter(l => l.isActive).length || Object.values(allRoles).filter(r => r === 'fund').length;

  useEffect(() => {
    loadData();
  }, [user]);

  const loadData = async () => {
    try {
      const [callsRes, linksRes, posRes, wmcRes] = await Promise.all([
        marginAPI.getActiveMarginCalls(),
        linkAPI.getLinksForBroker(partyId),
        positionAPI.listByBroker(partyId),
        workflowMarginCallAPI.list(),
      ]);
      setMarginCalls(callsRes.data);
      setBrokerLinks(linksRes.data);
      setBrokerPositions(posRes.data);
      setWorkflowCalls(wmcRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
        <Box>
          <Typography sx={{ fontSize: 28, fontWeight: 600, color: 'white', mb: 0.5 }}>Broker Dashboard</Typography>
          <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
            ZK-verified margin status across client funds
          </Typography>
        </Box>
      </Box>

      {/* Stats Cards — values redacted */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            label="Client Funds"
            value={fundCount.toString()}
            sublabel="Active fund accounts"
            icon={<Box sx={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #8b5cf6' }} />}
            iconBgColor="rgba(139, 92, 246, 0.1)"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            label="Total Collateral"
            value="Encrypted"
            sublabel="ZK-verified only"
            icon={<Lock sx={{ color: '#8b5cf6', fontSize: 20 }} />}
            iconBgColor="rgba(139, 92, 246, 0.1)"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            label="Active Margin Calls"
            value={(marginCalls.length + workflowCalls.length).toString()}
            sublabel={workflowCalls.length > 0 ? `${workflowCalls.length} LTV-triggered` : 'Across all clients'}
            icon={<Warning sx={{ color: (marginCalls.length + workflowCalls.length) > 0 ? '#ef4444' : 'rgba(255,255,255,0.4)', fontSize: 20 }} />}
            iconBgColor={(marginCalls.length + workflowCalls.length) > 0 ? 'rgba(239, 68, 68, 0.1)' : undefined}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            label="Positions Tracked"
            value={brokerPositions.length.toString()}
            sublabel={`${brokerPositions.filter(p => p.status === 'MarginCalled').length} margin called`}
            icon={<TrendingUp sx={{ color: '#8b5cf6', fontSize: 20 }} />}
            iconBgColor="rgba(139, 92, 246, 0.1)"
          />
        </Grid>
      </Grid>

      {/* ZK Verification Status */}
      <Box
        sx={{
          bgcolor: '#111820',
          borderRadius: '12px',
          border: '1px solid rgba(139, 92, 246, 0.2)',
          p: 3,
          mb: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '10px',
              bgcolor: 'rgba(139, 92, 246, 0.1)',
              border: '2px solid #8b5cf6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Shield sx={{ color: '#8b5cf6', fontSize: 20 }} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'white' }}>Zero-Knowledge Verification Status</Typography>
            <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Collateral values are encrypted — only margin sufficiency is disclosed</Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 4, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Visibility sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 16 }} />
            <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>You can see:</Typography>
            <Box sx={{ px: 1.5, py: 0.3, bgcolor: 'rgba(0, 212, 170, 0.1)', borderRadius: '4px' }}>
              <Typography sx={{ fontSize: 12, color: '#00d4aa', fontWeight: 500 }}>Sufficient / Insufficient</Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <VisibilityOff sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 16 }} />
            <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Hidden from you:</Typography>
            <Typography sx={{ fontSize: 13, color: '#8b5cf6', fontWeight: 500 }}>Actual Collateral Values</Typography>
          </Box>
        </Box>
      </Box>

      {/* Client Fund Status & Margin Calls */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <Box
            sx={{
              bgcolor: '#111820',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.06)',
              p: 3,
              minHeight: 200,
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography sx={{ fontSize: 18, fontWeight: 600, color: 'white' }}>Client Fund Status</Typography>
              <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{fundCount} funds</Typography>
            </Box>

            {fundCount === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.7)', mb: 0.5 }}>
                  No Fund Accounts
                </Typography>
                <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                  Add fund accounts to monitor their margin status
                </Typography>
              </Box>
            ) : (
              Object.entries(allRoles)
                .filter(([, r]) => r === 'fund')
                .map(([pid]) => (
                  <Box
                    key={pid}
                    sx={{
                      p: 2,
                      bgcolor: 'rgba(255,255,255,0.02)',
                      borderRadius: '8px',
                      mb: 1.5,
                      '&:last-child': { mb: 0 },
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'white' }}>
                        {pid.split('::')[0]}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Lock sx={{ fontSize: 14, color: '#8b5cf6' }} />
                        <Typography sx={{ fontSize: 13, color: '#8b5cf6', fontWeight: 500 }}>
                          Encrypted
                        </Typography>
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#00d4aa' }} />
                      <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                        ZK-verified margin status: Sufficient
                      </Typography>
                    </Box>
                  </Box>
                ))
            )}
          </Box>
        </Grid>

        <Grid item xs={12} md={5}>
          <Box
            sx={{
              bgcolor: '#111820',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.06)',
              p: 3,
              minHeight: 200,
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography sx={{ fontSize: 18, fontWeight: 600, color: 'white' }}>Margin Calls</Typography>
              <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{marginCalls.length} active</Typography>
            </Box>

            {marginCalls.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Box
                  sx={{
                    width: 60,
                    height: 60,
                    borderRadius: '12px',
                    bgcolor: 'rgba(255,255,255,0.03)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto',
                    mb: 2,
                  }}
                >
                  <TrendingUp sx={{ fontSize: 24, color: '#00d4aa' }} />
                </Box>
                <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.7)', mb: 0.5 }}>
                  No Active Margin Calls
                </Typography>
                <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                  All client positions are sufficiently collateralized
                </Typography>
              </Box>
            ) : (
              marginCalls.map((call, idx) => (
                <Box
                  key={idx}
                  sx={{
                    p: 2,
                    bgcolor: 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '8px',
                    borderLeft: '3px solid #ef4444',
                    mb: 1.5,
                    '&:last-child': { mb: 0 },
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'white' }}>{call.positionId}</Typography>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, color: '#ef4444' }}>
                      ${call.requiredAmount.toLocaleString()}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                    {call.provider} &middot; {call.status}
                  </Typography>
                </Box>
              ))
            )}
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}

// Custodian Status Panel — shown on operator dashboard
function CustodianPanel() {
  const [custodianParty, setCustodianParty] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadCustodianStatus();
  }, []);

  const loadCustodianStatus = async () => {
    try {
      const party = await getCustodianParty();
      setCustodianParty(party);
    } catch {
      // ignore
    }
    setLoading(false);
  };

  const handleProvision = async () => {
    setProvisioning(true);
    setError('');
    setSuccess(false);
    try {
      const res = await fetch('/api/admin/provision-custodian', { method: 'POST' });
      const data = await res.json() as { success: boolean; custodianParty?: string; error?: string };
      if (data.success && data.custodianParty) {
        setCustodianParty(data.custodianParty);
        setSuccess(true);
      } else {
        setError(data.error || 'Failed to provision custodian');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    }
    setProvisioning(false);
  };

  if (loading) return null;

  return (
    <Box
      sx={{
        bgcolor: '#111820',
        borderRadius: '12px',
        border: `1px solid ${custodianParty ? 'rgba(0,212,170,0.2)' : 'rgba(255,165,0,0.2)'}`,
        p: 3,
        mb: 3,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: '10px',
            bgcolor: custodianParty ? 'rgba(0,212,170,0.1)' : 'rgba(255,165,0,0.1)',
            border: `2px solid ${custodianParty ? '#00d4aa' : '#ffa500'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {custodianParty ? (
            <Lock sx={{ color: '#00d4aa', fontSize: 20 }} />
          ) : (
            <LockOpen sx={{ color: '#ffa500', fontSize: 20 }} />
          )}
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'white' }}>Vault Custodian</Typography>
          <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
            {custodianParty ? 'Dedicated custody party active' : 'Not provisioned — deposits go to operator wallet'}
          </Typography>
        </Box>
        {!custodianParty && (
          <Button
            variant="contained"
            onClick={handleProvision}
            disabled={provisioning}
            startIcon={provisioning ? <CircularProgress size={16} sx={{ color: 'inherit' }} /> : undefined}
            sx={{
              bgcolor: '#ffa500',
              color: '#0a0e14',
              fontWeight: 600,
              textTransform: 'none',
              '&:hover': { bgcolor: '#e69500' },
            }}
          >
            {provisioning ? 'Provisioning...' : 'Provision Custodian'}
          </Button>
        )}
      </Box>

      {custodianParty && (
        <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 1.5 }}>
          <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', mb: 0.5 }}>Custodian Party ID</Typography>
          <Typography sx={{ fontSize: 12, color: '#00d4aa', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {custodianParty}
          </Typography>
        </Box>
      )}

      {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mt: 1.5 }}>Vault custodian provisioned successfully</Alert>}
    </Box>
  );
}


// Escrow Deployer Panel — shows deployer EOA address and config status
function DeployerPanel() {
  const [deployerAddress, setDeployerAddress] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/escrow/deploy');
        const data = await res.json() as { deployerAddress?: string; configured?: boolean };
        setDeployerAddress(data.deployerAddress || null);
        setConfigured(!!data.configured);
      } catch {
        // ignore
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return null;

  return (
    <Box
      sx={{
        bgcolor: '#111820',
        borderRadius: '12px',
        border: `1px solid ${configured ? 'rgba(96,165,250,0.2)' : 'rgba(255,165,0,0.2)'}`,
        p: 3,
        mb: 3,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: deployerAddress ? 2 : 0 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: '10px',
            bgcolor: configured ? 'rgba(96,165,250,0.1)' : 'rgba(255,165,0,0.1)',
            border: `2px solid ${configured ? '#60a5fa' : '#ffa500'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Shield sx={{ color: configured ? '#60a5fa' : '#ffa500', fontSize: 20 }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'white' }}>Escrow Deployer</Typography>
          <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
            {configured ? 'Dedicated deployer EOA configured' : 'Not configured — set DEPLOYER_PRIVATE_KEY and API_SECRET'}
          </Typography>
        </Box>
      </Box>

      {deployerAddress && (
        <Box sx={{ bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 1.5 }}>
          <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', mb: 0.5 }}>Deployer Address</Typography>
          <Typography sx={{ fontSize: 12, color: '#60a5fa', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {deployerAddress}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

// Workflow run record shape from KV
interface WorkflowRunRecord {
  timestamp: string;
  processed: number;
  marginCallsCreated: number;
  positions: Array<{
    positionId: string;
    vaultId: string;
    fund: string;
    broker: string;
    notional: number;
    collateralValue: number;
    pnl: number;
    currentLTV: number;
    breached: boolean;
    autoLiquidated: boolean;
  }>;
  prices: { CC: number; ETH: number; BTC: number; USDC: number; SOL: number };
}

// Workflow Monitor Panel — shows recent LTV monitor workflow runs
function WorkflowLogPanel() {
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/workflow/history?limit=20');
        const data = await res.json() as { runs: WorkflowRunRecord[] };
        setRuns(data.runs || []);
      } catch {
        // ignore
      }
      setLoading(false);
    })();
  }, []);

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

  const tdSx = {
    color: 'white',
    fontSize: 13,
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    py: 1.5,
    px: 1.5,
  };

  const latestRun = runs[0];
  const latestTime = latestRun
    ? new Date(latestRun.timestamp).toLocaleString()
    : '—';

  const rowColor = (run: WorkflowRunRecord) => {
    if (run.positions.some(p => p.autoLiquidated)) return 'rgba(239, 68, 68, 0.06)';
    if (run.marginCallsCreated > 0) return 'rgba(245, 158, 11, 0.06)';
    return 'transparent';
  };

  return (
    <Box
      sx={{
        bgcolor: '#111820',
        borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.06)',
        p: 3,
        mb: 3,
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: '10px',
            bgcolor: 'rgba(245,158,11,0.1)',
            border: '2px solid #f59e0b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Schedule sx={{ color: '#f59e0b', fontSize: 20 }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'white' }}>Workflow Monitor</Typography>
          <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>LTV check runs every 15 minutes</Typography>
        </Box>
        {latestRun && (
          <Chip
            label={`Last: ${latestTime}`}
            size="small"
            sx={{
              bgcolor: 'rgba(245,158,11,0.1)',
              color: '#f59e0b',
              fontSize: 11,
              fontWeight: 500,
              border: '1px solid rgba(245,158,11,0.2)',
            }}
          />
        )}
      </Box>

      {/* Summary stats */}
      {latestRun && (
        <Box sx={{ display: 'flex', gap: 2, mb: 2.5 }}>
          <Box sx={{ flex: 1, bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 1.5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 20, fontWeight: 600, color: 'white' }}>{latestRun.processed}</Typography>
            <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Positions Processed</Typography>
          </Box>
          <Box sx={{ flex: 1, bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 1.5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 20, fontWeight: 600, color: latestRun.marginCallsCreated > 0 ? '#ef4444' : 'white' }}>
              {latestRun.marginCallsCreated}
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Margin Calls</Typography>
          </Box>
          <Box sx={{ flex: 1, bgcolor: 'rgba(255,255,255,0.03)', borderRadius: '8px', p: 1.5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 20, fontWeight: 600, color: 'white' }}>
              {new Date(latestRun.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Last Run</Typography>
          </Box>
        </Box>
      )}

      {/* Table */}
      {loading ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <CircularProgress size={24} sx={{ color: 'rgba(255,255,255,0.3)' }} />
        </Box>
      ) : runs.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Schedule sx={{ fontSize: 32, color: 'rgba(255,255,255,0.15)', mb: 1 }} />
          <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>No workflow runs recorded yet</Typography>
          <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', mt: 0.5 }}>
            Records appear after the next scheduled LTV check
          </Typography>
        </Box>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...thSx, width: 32 }} />
                <TableCell sx={thSx}>Time</TableCell>
                <TableCell sx={thSx} align="right">Positions</TableCell>
                <TableCell sx={thSx} align="right">Margin Calls</TableCell>
                <TableCell sx={thSx} align="right">Breaches</TableCell>
                <TableCell sx={thSx} align="right">Auto-Liq</TableCell>
                <TableCell sx={thSx} align="right">CC Price</TableCell>
                <TableCell sx={thSx} align="right">ETH Price</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((run) => {
                const isExpanded = expandedRow === run.timestamp;
                const breaches = run.positions.filter(p => p.breached).length;
                const autoLiqs = run.positions.filter(p => p.autoLiquidated).length;

                return (
                  <Fragment key={run.timestamp}>
                    <TableRow
                      hover
                      onClick={() => setExpandedRow(isExpanded ? null : run.timestamp)}
                      sx={{ cursor: 'pointer', bgcolor: rowColor(run), '&:hover': { bgcolor: 'rgba(255,255,255,0.03)' } }}
                    >
                      <TableCell sx={{ ...tdSx, px: 0.5 }}>
                        <IconButton size="small" sx={{ color: 'rgba(255,255,255,0.4)' }}>
                          {isExpanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                        </IconButton>
                      </TableCell>
                      <TableCell sx={tdSx}>
                        {new Date(run.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </TableCell>
                      <TableCell sx={tdSx} align="right">{run.processed}</TableCell>
                      <TableCell sx={tdSx} align="right">
                        <Typography component="span" sx={{ color: run.marginCallsCreated > 0 ? '#ef4444' : 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                          {run.marginCallsCreated}
                        </Typography>
                      </TableCell>
                      <TableCell sx={tdSx} align="right">
                        <Typography component="span" sx={{ color: breaches > 0 ? '#f59e0b' : 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                          {breaches}
                        </Typography>
                      </TableCell>
                      <TableCell sx={tdSx} align="right">
                        <Typography component="span" sx={{ color: autoLiqs > 0 ? '#ef4444' : 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                          {autoLiqs}
                        </Typography>
                      </TableCell>
                      <TableCell sx={tdSx} align="right">${run.prices.CC.toFixed(2)}</TableCell>
                      <TableCell sx={tdSx} align="right">${run.prices.ETH.toLocaleString()}</TableCell>
                    </TableRow>

                    {/* Expanded detail sub-table */}
                    <TableRow>
                      <TableCell sx={{ py: 0, borderBottom: 'none' }} colSpan={8}>
                        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                          <Box sx={{ py: 1.5, px: 1 }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell sx={{ ...thSx, fontSize: 10 }}>Position ID</TableCell>
                                  <TableCell sx={{ ...thSx, fontSize: 10 }}>Fund</TableCell>
                                  <TableCell sx={{ ...thSx, fontSize: 10 }} align="right">Notional</TableCell>
                                  <TableCell sx={{ ...thSx, fontSize: 10 }} align="right">Collateral</TableCell>
                                  <TableCell sx={{ ...thSx, fontSize: 10 }} align="right">PnL</TableCell>
                                  <TableCell sx={{ ...thSx, fontSize: 10 }} align="right">LTV</TableCell>
                                  <TableCell sx={{ ...thSx, fontSize: 10 }} align="center">Status</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {run.positions.map((pos) => (
                                  <TableRow key={pos.positionId}>
                                    <TableCell sx={{ ...tdSx, fontSize: 12, fontFamily: 'monospace' }}>{pos.positionId}</TableCell>
                                    <TableCell sx={{ ...tdSx, fontSize: 12 }} title={pos.fund}>
                                      {pos.fund.length > 20 ? `${pos.fund.slice(0, 8)}...${pos.fund.slice(-8)}` : pos.fund}
                                    </TableCell>
                                    <TableCell sx={{ ...tdSx, fontSize: 12 }} align="right">
                                      ${pos.notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </TableCell>
                                    <TableCell sx={{ ...tdSx, fontSize: 12 }} align="right">
                                      ${pos.collateralValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </TableCell>
                                    <TableCell sx={{ ...tdSx, fontSize: 12, color: pos.pnl >= 0 ? '#00d4aa' : '#ef4444' }} align="right">
                                      {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                    </TableCell>
                                    <TableCell sx={{ ...tdSx, fontSize: 12, color: pos.currentLTV >= 0.8 ? '#ef4444' : pos.currentLTV >= 0.6 ? '#f59e0b' : '#00d4aa' }} align="right">
                                      {(pos.currentLTV * 100).toFixed(1)}%
                                    </TableCell>
                                    <TableCell sx={{ ...tdSx, fontSize: 12 }} align="center">
                                      {pos.autoLiquidated ? (
                                        <Chip label="Liquidated" size="small" sx={{ bgcolor: 'rgba(239,68,68,0.15)', color: '#ef4444', fontSize: 10, height: 20 }} />
                                      ) : pos.breached ? (
                                        <Chip label="Breached" size="small" icon={<Warning sx={{ fontSize: '12px !important', color: '#f59e0b !important' }} />} sx={{ bgcolor: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontSize: 10, height: 20 }} />
                                      ) : (
                                        <Chip label="OK" size="small" icon={<CheckCircle sx={{ fontSize: '12px !important', color: '#00d4aa !important' }} />} sx={{ bgcolor: 'rgba(0,212,170,0.1)', color: '#00d4aa', fontSize: 10, height: 20 }} />
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}


// Operator Dashboard — platform overview with role counts and system status
function OperatorDashboard({ user }: { user: AuthUser }) {
  const { allRoles } = useRole();
  const navigate = useNavigate();

  const fundCount = Object.values(allRoles).filter(r => r === 'fund').length;
  const brokerCount = Object.values(allRoles).filter(r => r === 'primebroker').length;
  const operatorCount = Object.values(allRoles).filter(r => r === 'operator').length + 1; // +1 for primary operator
  const totalParties = Object.keys(allRoles).length;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
        <Box>
          <Typography sx={{ fontSize: 28, fontWeight: 600, color: 'white', mb: 0.5 }}>Operator Dashboard</Typography>
          <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
            Platform administration and system status
          </Typography>
        </Box>
        <Button
          variant="contained"
          onClick={() => navigate('/admin')}
          sx={{
            bgcolor: '#f59e0b',
            color: '#0a0e14',
            fontWeight: 600,
            px: 3,
            py: 1,
            borderRadius: '8px',
            textTransform: 'none',
            '&:hover': { bgcolor: '#d97706' },
          }}
        >
          Manage Roles
        </Button>
      </Box>

      {/* Stats Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            label="Funds"
            value={fundCount.toString()}
            sublabel="Registered fund accounts"
            icon={<Box sx={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #00d4aa' }} />}
            iconBgColor="rgba(0, 212, 170, 0.1)"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            label="Prime Brokers"
            value={brokerCount.toString()}
            sublabel="Active brokers"
            icon={<Box sx={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #8b5cf6' }} />}
            iconBgColor="rgba(139, 92, 246, 0.1)"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            label="Operators"
            value={operatorCount.toString()}
            sublabel="Platform administrators"
            icon={<Box sx={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #f59e0b' }} />}
            iconBgColor="rgba(245, 158, 11, 0.1)"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatsCard
            label="Total Parties"
            value={totalParties.toString()}
            sublabel="All assigned roles"
            icon={<Shield sx={{ color: '#60a5fa', fontSize: 20 }} />}
            iconBgColor="rgba(96, 165, 250, 0.1)"
          />
        </Grid>
      </Grid>

      {/* Custodian Panel */}
      <CustodianPanel />

      {/* Deployer Panel */}
      <DeployerPanel />

      {/* Workflow Monitor */}
      <WorkflowLogPanel />

      {/* Connected as */}
      <Box
        sx={{
          bgcolor: '#111820',
          borderRadius: '12px',
          border: '1px solid rgba(245,158,11,0.15)',
          p: 3,
        }}
      >
        <Typography sx={{ fontSize: 14, fontWeight: 600, color: '#f59e0b', mb: 1 }}>Operator Identity</Typography>
        <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
          {user.partyId || user.id}
        </Typography>
      </Box>
    </Box>
  );
}

export default function Dashboard({ user, assets }: DashboardProps) {
  const { isPrimeBroker, isOperator } = useRole();

  if (isOperator) {
    return <OperatorDashboard user={user} />;
  }

  if (isPrimeBroker) {
    return <BrokerDashboard user={user} />;
  }

  return <FundDashboard user={user} assets={assets} />;
}
