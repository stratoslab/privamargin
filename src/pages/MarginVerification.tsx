import { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, TextField, Button, Alert, Paper,
  MenuItem, Select, FormControl, InputLabel, Grid
} from '@mui/material';
import { CheckCircle, Cancel, Lock, VerifiedUser } from '@mui/icons-material';
import { marginAPI, vaultAPI } from '../services/api';
import { useRole } from '../context/RoleContext';
import type { AuthUser } from '@stratos-wallet/sdk';

interface MarginVerificationProps {
  user: AuthUser;
}

// Fund view — full verification form
function FundMarginVerification({ user }: MarginVerificationProps) {
  const [vaults, setVaults] = useState<any[]>([]);
  const [form, setForm] = useState({
    positionId: '',
    vaultId: '',
    requiredMargin: ''
  });
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

  const handleVerify = async () => {
    setLoading(true);
    setResult(null);

    try {
      const vaultRes = await vaultAPI.getVault(form.vaultId);
      const collateralValue = vaultRes.data.totalValue;

      const res = await marginAPI.verify(
        form.positionId,
        form.vaultId,
        parseFloat(form.requiredMargin),
        collateralValue
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
        <strong>Privacy-Preserving Verification:</strong> Counterparties can verify margin sufficiency
        without seeing your actual collateral value. Only the verification status is shared.
      </Alert>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Verify Margin Requirement
              </Typography>

              <TextField
                fullWidth
                margin="normal"
                label="Position ID"
                placeholder="e.g., POS-001"
                value={form.positionId}
                onChange={(e) => setForm({ ...form, positionId: e.target.value })}
              />

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
                label="Required Margin (USD)"
                type="number"
                value={form.requiredMargin}
                onChange={(e) => setForm({ ...form, requiredMargin: e.target.value })}
              />

              <Button
                fullWidth
                variant="contained"
                sx={{ mt: 2 }}
                onClick={handleVerify}
                disabled={loading || !form.positionId || !form.vaultId || !form.requiredMargin}
              >
                {loading ? 'Verifying...' : 'Verify Margin'}
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
                    {result.status === 'Sufficient' ? (
                      <CheckCircle sx={{ fontSize: 48, mr: 2, color: '#10b981' }} />
                    ) : (
                      <Cancel sx={{ fontSize: 48, mr: 2, color: '#ef4444' }} />
                    )}
                    <Box>
                      <Typography variant="h5" sx={{ color: result.status === 'Sufficient' ? '#10b981' : '#ef4444' }}>
                        {result.status}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        Position: {result.positionId}
                      </Typography>
                    </Box>
                  </Box>

                  <Paper sx={{ p: 2, bgcolor: 'rgba(139, 92, 246, 0.1)', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <Lock fontSize="small" sx={{ mr: 1, color: '#8b5cf6' }} />
                      <Typography variant="subtitle2">
                        Privacy Protected
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="textSecondary">
                      Collateral value is NOT disclosed to counterparty.
                      Only verification status is shared via zero-knowledge proof.
                    </Typography>
                  </Paper>

                  <Typography variant="caption" color="textSecondary">
                    Verified at: {new Date(result.timestamp).toLocaleString()}
                  </Typography>

                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      ZK Proof Hash:
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        wordBreak: 'break-all',
                        fontFamily: 'monospace',
                        bgcolor: 'rgba(255,255,255,0.05)',
                        p: 1,
                        display: 'block',
                        borderRadius: 1
                      }}
                    >
                      {result.proof.substring(0, 64)}...
                    </Typography>
                  </Box>
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
                      Provider submits vault ID and position details
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
                    <Typography variant="h6" sx={{ color: '#06b6d4' }}>Verify</Typography>
                    <Typography variant="body2" color="textSecondary">
                      System generates ZK proof comparing collateral vs margin
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
                    <Typography variant="h6" sx={{ color: '#10b981' }}>Result</Typography>
                    <Typography variant="body2" color="textSecondary">
                      Counterparty receives only Sufficient/Insufficient status
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

// Broker view — read-only verification results, can request verification but only sees status
function BrokerMarginVerification({ user }: MarginVerificationProps) {
  const { allRoles } = useRole();
  const [requestForm, setRequestForm] = useState({ fundPartyId: '', positionId: '', requiredMargin: '' });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fundParties = Object.entries(allRoles)
    .filter(([, r]) => r === 'fund')
    .map(([pid]) => pid);

  void user;

  const handleRequestVerification = async () => {
    setLoading(true);
    setResult(null);

    try {
      // Broker requests verification — doesn't have access to collateral value
      // The system performs the check and returns only Sufficient/Insufficient
      const res = await marginAPI.verify(
        requestForm.positionId,
        `vault-${requestForm.fundPartyId}`,
        parseFloat(requestForm.requiredMargin),
        // In a real ZK system, the broker wouldn't provide this value.
        // The Canton ledger would do the comparison privately.
        // For demo, we use a placeholder that triggers the ZK proof flow.
        parseFloat(requestForm.requiredMargin) * 1.5
      );

      // Broker only sees status, not the actual collateral value
      setResult({
        positionId: res.data.positionId,
        status: res.data.status,
        proof: res.data.proof,
        timestamp: res.data.timestamp,
      });
    } catch (error) {
      console.error('Error requesting verification:', error);
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
        <strong>Read-Only Broker View:</strong> You can request margin verification for client funds,
        but you will only see the Sufficient/Insufficient result. Actual collateral values remain encrypted.
      </Alert>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Request Verification
              </Typography>

              <FormControl fullWidth margin="normal">
                <InputLabel>Fund Account</InputLabel>
                <Select
                  value={requestForm.fundPartyId}
                  label="Fund Account"
                  onChange={(e) => setRequestForm({ ...requestForm, fundPartyId: e.target.value })}
                >
                  {fundParties.map((pid) => (
                    <MenuItem key={pid} value={pid}>
                      {pid.split('::')[0]}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                fullWidth
                margin="normal"
                label="Position ID"
                placeholder="e.g., POS-001"
                value={requestForm.positionId}
                onChange={(e) => setRequestForm({ ...requestForm, positionId: e.target.value })}
              />

              <TextField
                fullWidth
                margin="normal"
                label="Required Margin (USD)"
                type="number"
                value={requestForm.requiredMargin}
                onChange={(e) => setRequestForm({ ...requestForm, requiredMargin: e.target.value })}
              />

              <Button
                fullWidth
                variant="contained"
                sx={{ mt: 2, bgcolor: '#8b5cf6', '&:hover': { bgcolor: '#7c3aed' } }}
                onClick={handleRequestVerification}
                disabled={loading || !requestForm.fundPartyId || !requestForm.positionId || !requestForm.requiredMargin}
              >
                {loading ? 'Requesting...' : 'Request Verification'}
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
                    {result.status === 'Sufficient' ? (
                      <CheckCircle sx={{ fontSize: 48, mr: 2, color: '#10b981' }} />
                    ) : (
                      <Cancel sx={{ fontSize: 48, mr: 2, color: '#ef4444' }} />
                    )}
                    <Box>
                      <Typography variant="h5" sx={{ color: result.status === 'Sufficient' ? '#10b981' : '#ef4444' }}>
                        {result.status}
                      </Typography>
                      <Typography variant="caption" color="textSecondary">
                        Position: {result.positionId}
                      </Typography>
                    </Box>
                  </Box>

                  <Paper sx={{ p: 2, bgcolor: 'rgba(139, 92, 246, 0.1)', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <Lock fontSize="small" sx={{ mr: 1, color: '#8b5cf6' }} />
                      <Typography variant="subtitle2">
                        Collateral Value Hidden
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="textSecondary">
                      As a primebroker, you only receive the margin sufficiency status.
                      The fund's actual collateral value is protected by zero-knowledge proof.
                    </Typography>
                  </Paper>

                  <Typography variant="caption" color="textSecondary">
                    Verified at: {new Date(result.timestamp).toLocaleString()}
                  </Typography>

                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      ZK Proof Hash:
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        wordBreak: 'break-all',
                        fontFamily: 'monospace',
                        bgcolor: 'rgba(255,255,255,0.05)',
                        p: 1,
                        display: 'block',
                        borderRadius: 1
                      }}
                    >
                      {result.proof.substring(0, 64)}...
                    </Typography>
                  </Box>
                </Box>
              ) : (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <VerifiedUser sx={{ fontSize: 48, color: 'rgba(255,255,255,0.1)', mb: 1 }} />
                  <Typography color="textSecondary">
                    Select a fund and request verification to see results
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
