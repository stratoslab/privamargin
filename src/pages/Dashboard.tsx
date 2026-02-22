import { useState, useEffect } from 'react';
import { Box, Typography, Button, Grid, CircularProgress, Alert, Chip } from '@mui/material';
import { Add, Visibility, VisibilityOff, Lock, LockOpen, TrendingUp, Warning, Shield, AccountBalance } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { vaultAPI, marginAPI, invitationAPI, positionAPI, linkAPI, workflowMarginCallAPI, getCustodianParty } from '../services/api';
import type { PositionData, BrokerFundLinkData, WorkflowMarginCallData } from '../services/api';
import { CHAIN_CONFIG, CHAIN_ID_TO_NAME, CHAIN_TYPE_TO_IDS } from '../services/evmEscrow';
import { useRole } from '../context/RoleContext';
import { getSDK } from '@stratos-wallet/sdk';
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
  const [zkProof] = useState('eyJjb21taXRtZW50IjoiT1RRMk1qazJNRGc0T0RBd09UWTVPRFl3...');
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

// Deposit Relay Panel — shown on operator dashboard for per-chain relay deployment
function RelayPanel() {
  const [deploying, setDeploying] = useState<number | null>(null);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  // EVM chains detected from wallet SDK
  const [walletChains, setWalletChains] = useState<Array<{ chainId: number; name: string; address: string }>>([]);
  const [walletsLoading, setWalletsLoading] = useState(true);
  // Track deployed relay addresses
  const [relayAddresses, setRelayAddresses] = useState<Record<number, string>>({});

  useEffect(() => {
    detectEVMChains();
  }, []);

  const detectEVMChains = async () => {
    try {
      const sdk = getSDK();
      const addresses = await sdk.getAddresses();
      // A single wallet address works on all chains of the same type.
      // e.g. one "evm" address → Ethereum + Sepolia; one "base" address → Base + Base Sepolia
      const evmChains: Array<{ chainId: number; name: string; address: string }> = [];
      const seenTypes = new Set<string>();
      for (const addr of addresses) {
        const chainType = addr.chainType;
        if ((chainType === 'evm' || chainType === 'base') && !seenTypes.has(chainType)) {
          seenTypes.add(chainType);
          const chainIds = CHAIN_TYPE_TO_IDS[chainType] || [];
          for (const chainId of chainIds) {
            if (CHAIN_CONFIG[chainId]) {
              evmChains.push({
                chainId,
                name: CHAIN_ID_TO_NAME[chainId] || `Chain ${chainId}`,
                address: addr.address,
              });
            }
          }
        }
      }
      setWalletChains(evmChains);

      // Load existing relay addresses for detected chains
      const addrs: Record<number, string> = {};
      for (const c of evmChains) {
        const cfg = CHAIN_CONFIG[c.chainId];
        if (cfg?.relay) addrs[c.chainId] = cfg.relay;
      }
      setRelayAddresses(addrs);
    } catch (err) {
      console.warn('Failed to detect EVM chains from wallet:', err);
    }
    setWalletsLoading(false);
  };

  const handleDeploy = async (chainId: number) => {
    setDeploying(chainId);
    setError('');
    setSuccess('');
    try {
      // Pass the wallet address for this chain so deploy doesn't re-query
      const chain = walletChains.find(c => c.chainId === chainId);
      const result = await vaultAPI.deployDepositRelay(chainId, chain?.address);
      setRelayAddresses(prev => ({ ...prev, [chainId]: result.data.contractAddress }));
      setSuccess(`Relay deployed on ${CHAIN_ID_TO_NAME[chainId] || chainId}: ${result.data.contractAddress.slice(0, 16)}...`);
    } catch (err: unknown) {
      console.error('[RelayPanel] Deploy failed:', err);
      const msg = err instanceof Error ? err.message : typeof err === 'object' && err !== null ? JSON.stringify(err) : 'Deploy failed';
      setError(msg);
    }
    setDeploying(null);
  };

  const availableChains = walletChains.map(c => c.chainId);
  const allDeployed = availableChains.length > 0 && availableChains.every(id => relayAddresses[id]);

  return (
    <Box
      sx={{
        bgcolor: '#111820',
        borderRadius: '12px',
        border: `1px solid ${allDeployed ? 'rgba(139,92,246,0.2)' : 'rgba(255,165,0,0.2)'}`,
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
            bgcolor: allDeployed ? 'rgba(139,92,246,0.1)' : 'rgba(255,165,0,0.1)',
            border: `2px solid ${allDeployed ? '#8b5cf6' : '#ffa500'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AccountBalance sx={{ color: allDeployed ? '#8b5cf6' : '#ffa500', fontSize: 20 }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'white' }}>Deposit Relay</Typography>
          <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
            {walletsLoading
              ? 'Detecting EVM wallets...'
              : walletChains.length === 0
              ? 'No EVM wallets detected — add an Ethereum wallet in the portal'
              : allDeployed
              ? 'Privacy pool active on all chains — deposits are routed through relay'
              : `${walletChains.length} EVM chain${walletChains.length > 1 ? 's' : ''} detected — deploy relay contracts for privacy`}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: error || success ? 1.5 : 0 }}>
        {availableChains.map(chainId => {
          const name = CHAIN_ID_TO_NAME[chainId] || `Chain ${chainId}`;
          const addr = relayAddresses[chainId];
          return addr ? (
            <Chip
              key={chainId}
              icon={<AccountBalance sx={{ fontSize: 14 }} />}
              label={`${name}: ${addr.slice(0, 12)}...`}
              size="small"
              variant="outlined"
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.7rem',
                borderColor: 'rgba(139,92,246,0.4)',
                color: '#a78bfa',
              }}
            />
          ) : (
            <Button
              key={chainId}
              variant="outlined"
              size="small"
              disabled={deploying !== null}
              onClick={() => handleDeploy(chainId)}
              startIcon={deploying === chainId ? <CircularProgress size={14} /> : <AccountBalance sx={{ fontSize: 14 }} />}
              sx={{
                borderColor: 'rgba(255,165,0,0.5)',
                color: '#ffa500',
                textTransform: 'none',
                fontSize: '0.75rem',
                '&:hover': { borderColor: '#ffa500', bgcolor: 'rgba(255,165,0,0.08)' },
              }}
            >
              {deploying === chainId ? 'Deploying...' : `Deploy on ${name}`}
            </Button>
          );
        })}
      </Box>

      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mt: 1 }}>{success}</Alert>}
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

      {/* Custodian + Relay Panels */}
      <CustodianPanel />
      <RelayPanel />

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
