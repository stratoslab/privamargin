import { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Chip, Grid,
  Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import { CheckCircle, Cancel, Handshake, Warning } from '@mui/icons-material';
import { invitationAPI, linkAPI, proposalAPI } from '../services/api';
import type { Invitation, BrokerFundLinkData, LTVChangeProposalData } from '../services/api';
import type { AuthUser } from '@stratos-wallet/sdk';

interface FundBrokerLinksProps {
  user: AuthUser;
}

export default function FundBrokerLinks({ user }: FundBrokerLinksProps) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [links, setLinks] = useState<BrokerFundLinkData[]>([]);
  const [proposals, setProposals] = useState<LTVChangeProposalData[]>([]);
  const [processing, setProcessing] = useState<string | null>(null);
  const [rejectingProposal, setRejectingProposal] = useState<LTVChangeProposalData | null>(null);

  const partyId = user.partyId || user.id;

  useEffect(() => {
    loadData();
  }, [user]);

  const loadData = async () => {
    try {
      const [invRes, linkRes, propRes] = await Promise.all([
        invitationAPI.listPendingForFund(partyId),
        linkAPI.getLinksForFund(partyId),
        proposalAPI.listForFund(partyId),
      ]);
      setInvitations(invRes.data);
      setLinks(linkRes.data);
      setProposals(propRes.data);
    } catch (error) {
      console.error('Error loading broker links:', error);
    }
  };

  const handleAccept = async (contractId: string) => {
    setProcessing(contractId);
    try {
      await invitationAPI.accept(contractId);
      await loadData();
    } catch (error) {
      console.error('Error accepting invitation:', error);
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (contractId: string) => {
    setProcessing(contractId);
    try {
      await invitationAPI.reject(contractId);
      await loadData();
    } catch (error) {
      console.error('Error rejecting invitation:', error);
    } finally {
      setProcessing(null);
    }
  };

  const handleAcceptProposal = async (proposal: LTVChangeProposalData) => {
    setProcessing(proposal.contractId);
    try {
      await proposalAPI.accept(proposal.contractId);
      await loadData();
    } catch (error) {
      console.error('Error accepting proposal:', error);
    } finally {
      setProcessing(null);
    }
  };

  const handleRejectProposal = async () => {
    if (!rejectingProposal) return;
    setProcessing(rejectingProposal.contractId);
    try {
      await proposalAPI.reject(rejectingProposal.contractId, partyId, rejectingProposal.broker);
      setRejectingProposal(null);
      await loadData();
    } catch (error) {
      console.error('Error rejecting proposal:', error);
    } finally {
      setProcessing(null);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
        <Box>
          <Typography sx={{ fontSize: 28, fontWeight: 600, color: 'white', mb: 0.5 }}>My Brokers</Typography>
          <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
            Manage broker relationships and invitations
          </Typography>
        </Box>
      </Box>

      {/* Pending Invitations */}
      <Box
        sx={{
          bgcolor: '#111820',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.06)',
          p: 3,
          mb: 3,
        }}
      >
        <Typography sx={{ fontSize: 18, fontWeight: 600, color: 'white', mb: 2 }}>
          Pending Invitations
        </Typography>

        {invitations.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Handshake sx={{ fontSize: 40, color: 'rgba(255,255,255,0.2)', mb: 1 }} />
            <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>
              No pending invitations
            </Typography>
          </Box>
        ) : (
          invitations.map((inv) => (
            <Box
              key={inv.contractId}
              sx={{
                p: 2,
                bgcolor: 'rgba(139, 92, 246, 0.05)',
                borderRadius: '8px',
                border: '1px solid rgba(139, 92, 246, 0.15)',
                mb: 1.5,
                '&:last-child': { mb: 0 },
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'white', mb: 0.5 }}>
                    Broker: {inv.broker.split('::')[0]}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                    Invitation ID: {inv.invitationId}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<CheckCircle />}
                    onClick={() => handleAccept(inv.contractId)}
                    disabled={processing === inv.contractId}
                    sx={{
                      bgcolor: '#00d4aa',
                      color: '#0a0e14',
                      fontWeight: 600,
                      textTransform: 'none',
                      '&:hover': { bgcolor: '#00c49a' },
                    }}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Cancel />}
                    onClick={() => handleReject(inv.contractId)}
                    disabled={processing === inv.contractId}
                    sx={{
                      borderColor: 'rgba(239,68,68,0.5)',
                      color: '#ef4444',
                      textTransform: 'none',
                      '&:hover': { borderColor: '#ef4444', bgcolor: 'rgba(239,68,68,0.1)' },
                    }}
                  >
                    Reject
                  </Button>
                </Box>
              </Box>
            </Box>
          ))
        )}
      </Box>

      {/* Pending LTV Proposals */}
      {proposals.length > 0 && (
        <Box
          sx={{
            bgcolor: '#111820',
            borderRadius: '12px',
            border: '1px solid rgba(245,158,11,0.3)',
            p: 3,
            mb: 3,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Warning sx={{ color: '#f59e0b', fontSize: 20 }} />
            <Typography sx={{ fontSize: 18, fontWeight: 600, color: 'white' }}>
              Pending LTV Change Proposals
            </Typography>
          </Box>

          {proposals.map((proposal) => (
            <Box
              key={proposal.contractId}
              sx={{
                p: 2,
                bgcolor: 'rgba(245,158,11,0.05)',
                borderRadius: '8px',
                border: '1px solid rgba(245,158,11,0.15)',
                mb: 1.5,
                '&:last-child': { mb: 0 },
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'white', mb: 0.5 }}>
                    Broker: {proposal.broker.split('::')[0]}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <Box>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Current</Typography>
                      <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>
                        {(proposal.currentThreshold * 100).toFixed(0)}%
                      </Typography>
                    </Box>
                    <Typography sx={{ fontSize: 16, color: 'rgba(255,255,255,0.3)', alignSelf: 'flex-end', mb: 0.3 }}>→</Typography>
                    <Box>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Proposed</Typography>
                      <Typography sx={{ fontSize: 16, fontWeight: 600, color: '#f59e0b' }}>
                        {(proposal.proposedThreshold * 100).toFixed(0)}%
                      </Typography>
                    </Box>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<CheckCircle />}
                    onClick={() => handleAcceptProposal(proposal)}
                    disabled={processing === proposal.contractId}
                    sx={{
                      bgcolor: '#00d4aa',
                      color: '#0a0e14',
                      fontWeight: 600,
                      textTransform: 'none',
                      '&:hover': { bgcolor: '#00c49a' },
                    }}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Cancel />}
                    onClick={() => setRejectingProposal(proposal)}
                    disabled={processing === proposal.contractId}
                    sx={{
                      borderColor: 'rgba(239,68,68,0.5)',
                      color: '#ef4444',
                      textTransform: 'none',
                      '&:hover': { borderColor: '#ef4444', bgcolor: 'rgba(239,68,68,0.1)' },
                    }}
                  >
                    Reject
                  </Button>
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Active Broker Links */}
      <Box
        sx={{
          bgcolor: '#111820',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.06)',
          p: 3,
        }}
      >
        <Typography sx={{ fontSize: 18, fontWeight: 600, color: 'white', mb: 2 }}>
          Active Broker Links
        </Typography>

        {links.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>
              No active broker links. Accept an invitation to get started.
            </Typography>
          </Box>
        ) : (
          <Grid container spacing={2}>
            {links.map((link) => (
              <Grid item xs={12} md={6} key={link.contractId}>
                <Box
                  sx={{
                    p: 2.5,
                    bgcolor: 'rgba(255,255,255,0.02)',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 500, color: 'white' }}>
                      {link.broker.split('::')[0]}
                    </Typography>
                    <Chip
                      label={link.isActive ? 'Active' : 'Inactive'}
                      size="small"
                      sx={{
                        bgcolor: link.isActive ? 'rgba(0,212,170,0.2)' : 'rgba(255,255,255,0.1)',
                        color: link.isActive ? '#00d4aa' : 'rgba(255,255,255,0.5)',
                        fontWeight: 600,
                        fontSize: 11,
                      }}
                    />
                  </Box>
                  <Box sx={{ display: 'flex', gap: 3, mb: 1.5 }}>
                    <Box>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', mb: 0.3 }}>LTV Threshold</Typography>
                      <Typography sx={{ fontSize: 16, fontWeight: 600, color: '#f59e0b' }}>
                        {(link.ltvThreshold * 100).toFixed(0)}%
                      </Typography>
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', mb: 0.3 }}>Link ID</Typography>
                      <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>
                        {link.linkId}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Tradeable Assets */}
                  {link.allowedAssets && link.allowedAssets.length > 0 && (
                    <Box sx={{ mb: 1 }}>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', mb: 0.5 }}>Tradeable Assets</Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {link.allowedAssets.slice(0, 6).map(asset => (
                          <Chip
                            key={asset}
                            label={asset}
                            size="small"
                            sx={{ bgcolor: 'rgba(139,92,246,0.1)', color: '#8b5cf6', fontWeight: 600, fontSize: 10, height: 22 }}
                          />
                        ))}
                        {link.allowedAssets.length > 6 && (
                          <Chip
                            label={`+${link.allowedAssets.length - 6}`}
                            size="small"
                            sx={{ bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', fontSize: 10, height: 22 }}
                          />
                        )}
                      </Box>
                    </Box>
                  )}

                  {/* Allowed Collaterals */}
                  {link.allowedCollaterals && link.allowedCollaterals.length > 0 && (
                    <Box>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', mb: 0.5 }}>Allowed Collaterals</Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {link.allowedCollaterals.slice(0, 6).map(asset => (
                          <Chip
                            key={asset}
                            label={asset}
                            size="small"
                            sx={{ bgcolor: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontWeight: 600, fontSize: 10, height: 22 }}
                          />
                        ))}
                        {link.allowedCollaterals.length > 6 && (
                          <Chip
                            label={`+${link.allowedCollaterals.length - 6}`}
                            size="small"
                            sx={{ bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', fontSize: 10, height: 22 }}
                          />
                        )}
                      </Box>
                    </Box>
                  )}
                </Box>
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      {/* Reject Proposal Confirmation Dialog */}
      <Dialog
        open={!!rejectingProposal}
        onClose={() => setRejectingProposal(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#111820', color: 'white' } }}
      >
        <DialogTitle sx={{ color: '#ef4444' }}>Reject LTV Change Proposal</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', mb: 2 }}>
            Rejecting this proposal will:
          </Typography>
          <Box sx={{ pl: 2, mb: 2 }}>
            <Typography sx={{ fontSize: 13, color: '#ef4444', mb: 0.5 }}>
              1. Close all open positions with this broker
            </Typography>
            <Typography sx={{ fontSize: 13, color: '#ef4444' }}>
              2. Deactivate the broker-fund link
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
            Broker: {rejectingProposal?.broker.split('::')[0]}
            {' · '}
            Proposed: {rejectingProposal && (rejectingProposal.proposedThreshold * 100).toFixed(0)}%
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectingProposal(null)} sx={{ color: 'rgba(255,255,255,0.5)' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleRejectProposal}
            disabled={!!processing}
            sx={{ bgcolor: '#ef4444', '&:hover': { bgcolor: '#dc2626' } }}
          >
            Confirm Reject
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
