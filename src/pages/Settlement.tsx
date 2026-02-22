import { useState, useEffect } from 'react';
import { Box, Typography, Card, CardContent, Chip, Button, Alert, Grid } from '@mui/material';
import { Warning, CheckCircle } from '@mui/icons-material';
import { marginAPI, workflowMarginCallAPI } from '../services/api';
import type { WorkflowMarginCallData } from '../services/api';
import { useRole } from '../context/RoleContext';
import type { AuthUser } from '@stratos-wallet/sdk';

interface SettlementProps {
  user: AuthUser;
}

export default function Settlement({ user }: SettlementProps) {
  const [marginCalls, setMarginCalls] = useState<any[]>([]);
  const [workflowCalls, setWorkflowCalls] = useState<WorkflowMarginCallData[]>([]);
  const [settling, setSettling] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const { isPrimeBroker, isFund } = useRole();

  useEffect(() => {
    loadMarginCalls();
  }, []);

  const loadMarginCalls = async () => {
    try {
      const [res, wmcRes] = await Promise.all([
        marginAPI.getActiveMarginCalls(),
        workflowMarginCallAPI.list(),
      ]);
      setMarginCalls(res.data);
      setWorkflowCalls(wmcRes.data);
    } catch (error) {
      console.error('Error loading margin calls:', error);
    }
  };

  const handleSettle = async (marginCallId: string) => {
    setSettling(marginCallId);
    try {
      await marginAPI.settleMarginCall(marginCallId);
      await loadMarginCalls();
    } catch (error) {
      console.error('Error settling margin call:', error);
    } finally {
      setSettling(null);
    }
  };

  const handleAcknowledge = async (contractId: string) => {
    setAcknowledging(contractId);
    try {
      await workflowMarginCallAPI.acknowledge(contractId);
      await loadMarginCalls();
    } catch (error) {
      console.error('Error acknowledging margin call:', error);
    } finally {
      setAcknowledging(null);
    }
  };

  void user;

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700 }}>
        Settlement & Margin Calls
      </Typography>

      {isPrimeBroker && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <strong>Broker View:</strong> You can see all active margin calls across client funds and trigger settlements.
        </Alert>
      )}

      {marginCalls.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {isPrimeBroker
            ? `There are ${marginCalls.length} active margin call(s) across client funds`
            : `You have ${marginCalls.length} active margin call(s) requiring attention`}
        </Alert>
      )}

      <Grid container spacing={3}>
        {marginCalls.length === 0 ? (
          <Grid item xs={12}>
            <Card>
              <CardContent sx={{ textAlign: 'center', py: 6 }}>
                <CheckCircle sx={{ fontSize: 64, mb: 2, color: '#10b981' }} />
                <Typography variant="h6">
                  No Active Margin Calls
                </Typography>
                <Typography color="textSecondary">
                  {isPrimeBroker
                    ? 'All client positions are adequately collateralized'
                    : 'All positions are adequately collateralized'}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ) : (
          marginCalls.map((call) => (
            <Grid item xs={12} md={6} key={call.id}>
              <Card sx={{ borderLeft: '4px solid #ef4444' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                    <Typography variant="h6">
                      Margin Call
                    </Typography>
                    <Chip
                      icon={<Warning />}
                      label={call.status}
                      color="error"
                    />
                  </Box>

                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="textSecondary">
                        Position ID
                      </Typography>
                      <Typography variant="body1" sx={{ fontWeight: 500 }}>
                        {call.positionId}
                      </Typography>
                    </Grid>

                    <Grid item xs={6}>
                      <Typography variant="caption" color="textSecondary">
                        Required Amount
                      </Typography>
                      <Typography variant="body1" sx={{ fontWeight: 500, color: '#ef4444' }}>
                        ${call.requiredAmount.toLocaleString()}
                      </Typography>
                    </Grid>

                    <Grid item xs={6}>
                      <Typography variant="caption" color="textSecondary">
                        Provider
                      </Typography>
                      <Typography variant="body2">
                        {call.provider}
                      </Typography>
                    </Grid>

                    <Grid item xs={6}>
                      <Typography variant="caption" color="textSecondary">
                        Counterparty
                      </Typography>
                      <Typography variant="body2">
                        {call.counterparty}
                      </Typography>
                    </Grid>

                    <Grid item xs={12}>
                      <Typography variant="caption" color="textSecondary">
                        Created
                      </Typography>
                      <Typography variant="body2">
                        {new Date(call.createdAt).toLocaleString()}
                      </Typography>
                    </Grid>
                  </Grid>

                  <Button
                    fullWidth
                    variant="contained"
                    color="error"
                    sx={{ mt: 2 }}
                    onClick={() => handleSettle(call.id)}
                    disabled={settling === call.id}
                  >
                    {settling === call.id
                      ? 'Settling...'
                      : isPrimeBroker
                        ? 'Trigger Settlement'
                        : 'Settle Margin Call'}
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))
        )}

        {/* Workflow Margin Calls (LTV-triggered) */}
        {workflowCalls.length > 0 && (
          <>
            <Grid item xs={12}>
              <Typography variant="h6" sx={{ fontWeight: 600, color: 'white', mt: 2, mb: 1 }}>
                LTV-Triggered Margin Calls
              </Typography>
            </Grid>
            {workflowCalls.map((wmc) => (
              <Grid item xs={12} md={6} key={wmc.contractId}>
                <Card sx={{ borderLeft: '4px solid #f59e0b' }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                      <Typography variant="h6">LTV Breach</Typography>
                      <Chip
                        label={wmc.status}
                        color="warning"
                        size="small"
                      />
                    </Box>

                    <Grid container spacing={2}>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="textSecondary">Position ID</Typography>
                        <Typography variant="body1" sx={{ fontWeight: 500 }}>{wmc.positionId}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="textSecondary">Vault ID</Typography>
                        <Typography variant="body1" sx={{ fontWeight: 500 }}>{wmc.vaultId}</Typography>
                      </Grid>
                      <Grid item xs={4}>
                        <Typography variant="caption" color="textSecondary">Current LTV</Typography>
                        <Typography variant="body1" sx={{ fontWeight: 500, color: '#ef4444' }}>
                          {(wmc.currentLTV * 100).toFixed(1)}%
                        </Typography>
                      </Grid>
                      <Grid item xs={4}>
                        <Typography variant="caption" color="textSecondary">Threshold</Typography>
                        <Typography variant="body1" sx={{ fontWeight: 500, color: '#f59e0b' }}>
                          {(wmc.ltvThreshold * 100).toFixed(0)}%
                        </Typography>
                      </Grid>
                      <Grid item xs={4}>
                        <Typography variant="caption" color="textSecondary">Required</Typography>
                        <Typography variant="body1" sx={{ fontWeight: 500, color: '#ef4444' }}>
                          ${wmc.requiredAmount.toLocaleString()}
                        </Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="textSecondary">Fund</Typography>
                        <Typography variant="body2">{wmc.fund.split('::')[0]}</Typography>
                      </Grid>
                      <Grid item xs={6}>
                        <Typography variant="caption" color="textSecondary">Broker</Typography>
                        <Typography variant="body2">{wmc.broker.split('::')[0]}</Typography>
                      </Grid>
                    </Grid>

                    {isFund && wmc.status === 'WMCActive' && (
                      <Button
                        fullWidth
                        variant="contained"
                        color="warning"
                        sx={{ mt: 2 }}
                        onClick={() => handleAcknowledge(wmc.contractId)}
                        disabled={acknowledging === wmc.contractId}
                      >
                        {acknowledging === wmc.contractId ? 'Acknowledging...' : 'Acknowledge'}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </>
        )}

        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {isPrimeBroker ? 'Settlement Process (Broker)' : 'Automated Settlement Process'}
              </Typography>
              <Typography variant="body2" paragraph color="textSecondary">
                {isPrimeBroker
                  ? 'As a primebroker, you can monitor and trigger settlements for margin calls across all client funds:'
                  : 'When a margin call is triggered due to insufficient collateral:'}
              </Typography>

              <Grid container spacing={2}>
                {(isPrimeBroker
                  ? [
                      { step: 1, text: 'System detects insufficient collateral via ZK verification' },
                      { step: 2, text: 'Margin call is created and visible to broker and fund' },
                      { step: 3, text: 'Broker can trigger settlement or wait for fund to resolve' },
                      { step: 4, text: 'Settlement executes privately via smart contract' },
                    ]
                  : [
                      { step: 1, text: 'System automatically notifies both parties' },
                      { step: 2, text: 'Provider has 24 hours to add collateral or settle' },
                      { step: 3, text: 'If not resolved, smart contract executes automatic settlement' },
                      { step: 4, text: 'Required collateral is privately transferred to counterparty' },
                    ]
                ).map((item) => (
                  <Grid item xs={12} md={6} key={item.step}>
                    <Box sx={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 2,
                      p: 2,
                      bgcolor: 'rgba(255,255,255,0.05)',
                      borderRadius: 1
                    }}>
                      <Box sx={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        bgcolor: '#8b5cf6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontWeight: 700,
                        fontSize: 14,
                        flexShrink: 0
                      }}>
                        {item.step}
                      </Box>
                      <Typography variant="body2">
                        {item.text}
                      </Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
