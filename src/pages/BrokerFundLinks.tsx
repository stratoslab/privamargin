import { useState, useEffect } from 'react';
import {
  Box, Typography, Button, TextField, Chip, Grid, Slider,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Switch, FormControlLabel
} from '@mui/material';
import { Send, People, Edit, Security, Bolt, LinkOff } from '@mui/icons-material';
import { invitationAPI, linkAPI, proposalAPI, assetAPI } from '../services/api';
import type { Invitation, BrokerFundLinkData, LTVChangeProposalData } from '../services/api';
import { useRole } from '../context/RoleContext';
import type { AuthUser } from '@stratos-wallet/sdk';


interface BrokerFundLinksProps {
  user: AuthUser;
}

export default function BrokerFundLinks({ user }: BrokerFundLinksProps) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [links, setLinks] = useState<BrokerFundLinkData[]>([]);
  const [proposals, setProposals] = useState<LTVChangeProposalData[]>([]);
  const [fundPartyId, setFundPartyId] = useState('');
  const [sending, setSending] = useState(false);
  const [editingLink, setEditingLink] = useState<BrokerFundLinkData | null>(null);
  const [newThreshold, setNewThreshold] = useState(80);
  const [newLeverage, setNewLeverage] = useState(1);
  const [editingAssets, setEditingAssets] = useState<BrokerFundLinkData | null>(null);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [editingCollaterals, setEditingCollaterals] = useState<BrokerFundLinkData | null>(null);
  const [selectedCollaterals, setSelectedCollaterals] = useState<string[]>([]);
  const [allAssetTypes, setAllAssetTypes] = useState<string[]>([]);
  const [autoLiqPrefs, setAutoLiqPrefs] = useState<Record<string, boolean>>({});
  const [deactivatingLink, setDeactivatingLink] = useState<BrokerFundLinkData | null>(null);
  const { allRoles, assignRole } = useRole();

  const partyId = user.partyId || user.id;

  // Find operator from config
  const [operatorParty, setOperatorParty] = useState('');

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then((d: unknown) => setOperatorParty((d as { operatorParty?: string }).operatorParty || ''))
      .catch(() => {});
    assetAPI.getTypes().then(res => setAllAssetTypes(res.data.map(a => a.type)));
    loadData();
  }, [user]);

  const loadData = async () => {
    try {
      const [invRes, linkRes, propRes, alPrefs] = await Promise.all([
        invitationAPI.listSentByBroker(partyId),
        linkAPI.getLinksForBroker(partyId),
        proposalAPI.listForBroker(partyId),
        linkAPI.getAutoLiquidatePrefs(partyId),
      ]);
      setInvitations(invRes.data);
      setLinks(linkRes.data);
      setProposals(propRes.data);
      setAutoLiqPrefs(alPrefs);
    } catch (error) {
      console.error('Error loading fund links:', error);
    }
  };

  const handleSendInvitation = async () => {
    if (!fundPartyId.trim()) return;
    setSending(true);
    try {
      // Auto-assign fund role if not already assigned
      const existingRole = allRoles[fundPartyId.trim()];
      if (!existingRole) {
        await assignRole(fundPartyId.trim(), 'fund');
      }
      await invitationAPI.send(partyId, fundPartyId.trim(), operatorParty || partyId);
      setFundPartyId('');
      await loadData();
    } catch (error) {
      console.error('Error sending invitation:', error);
    } finally {
      setSending(false);
    }
  };

  const handleUpdateThreshold = async () => {
    if (!editingLink) return;
    try {
      const proposedLev = newLeverage !== editingLink.leverageRatio ? newLeverage : undefined;
      await proposalAPI.propose(editingLink.contractId, newThreshold / 100, editingLink.ltvThreshold, proposedLev);
      setEditingLink(null);
      await loadData();
    } catch (error) {
      console.error('Error proposing LTV change:', error);
    }
  };

  const handleUpdateAllowedAssets = async () => {
    if (!editingAssets) return;
    try {
      await linkAPI.updateAllowedAssets(editingAssets.contractId, selectedAssets);
      setEditingAssets(null);
      await loadData();
    } catch (error) {
      console.error('Error updating allowed assets:', error);
    }
  };

  const handleUpdateAllowedCollaterals = async () => {
    if (!editingCollaterals) return;
    try {
      await linkAPI.updateAllowedCollaterals(editingCollaterals.contractId, selectedCollaterals);
      setEditingCollaterals(null);
      await loadData();
    } catch (error) {
      console.error('Error updating allowed collaterals:', error);
    }
  };

  const handleDeactivateLink = async () => {
    if (!deactivatingLink) return;
    try {
      await linkAPI.deactivate(deactivatingLink.contractId);
      setDeactivatingLink(null);
      await loadData();
    } catch (error) {
      console.error('Error deactivating link:', error);
    }
  };

  // Check if a fund has a pending proposal
  const getPendingProposal = (fund: string) => proposals.find(p => p.fund === fund);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
        <Box>
          <Typography sx={{ fontSize: 28, fontWeight: 600, color: 'white', mb: 0.5 }}>My Funds</Typography>
          <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
            Manage fund relationships, invitations, and LTV thresholds
          </Typography>
        </Box>
      </Box>

      {/* Send Invitation */}
      <Box
        sx={{
          bgcolor: '#111820',
          borderRadius: '12px',
          border: '1px solid rgba(139, 92, 246, 0.2)',
          p: 3,
          mb: 3,
        }}
      >
        <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'white', mb: 2 }}>
          Send Invitation
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            fullWidth
            placeholder="Enter fund party ID"
            value={fundPartyId}
            onChange={(e) => setFundPartyId(e.target.value)}
            sx={{
              '& .MuiOutlinedInput-root': {
                color: 'white',
                '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
                '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
              },
              '& .MuiInputBase-input::placeholder': { color: 'rgba(255,255,255,0.3)' },
            }}
          />
          <Button
            variant="contained"
            startIcon={<Send />}
            onClick={handleSendInvitation}
            disabled={!fundPartyId.trim() || sending}
            sx={{
              bgcolor: '#8b5cf6',
              color: 'white',
              fontWeight: 600,
              textTransform: 'none',
              whiteSpace: 'nowrap',
              px: 3,
              '&:hover': { bgcolor: '#7c3aed' },
              '&.Mui-disabled': { bgcolor: 'rgba(139,92,246,0.3)' },
            }}
          >
            {sending ? 'Sending...' : 'Send Invite'}
          </Button>
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
        <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'white', mb: 2 }}>
          Pending Invitations ({invitations.length})
        </Typography>

        {invitations.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center', py: 2 }}>
            No pending invitations
          </Typography>
        ) : (
          invitations.map((inv) => (
            <Box
              key={inv.contractId}
              sx={{
                p: 2,
                bgcolor: 'rgba(255,255,255,0.02)',
                borderRadius: '8px',
                mb: 1,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Box>
                <Typography sx={{ fontSize: 14, color: 'white' }}>
                  Fund: {inv.fund.split('::')[0]}
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  {inv.invitationId} &middot; {new Date(inv.createdAt).toLocaleDateString()}
                </Typography>
              </Box>
              <Chip
                label="Pending"
                size="small"
                sx={{ bgcolor: 'rgba(245,158,11,0.2)', color: '#f59e0b', fontWeight: 600 }}
              />
            </Box>
          ))
        )}
      </Box>

      {/* Linked Funds */}
      <Box
        sx={{
          bgcolor: '#111820',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.06)',
          p: 3,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 600, color: 'white' }}>
            Linked Funds
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
            {links.length} linked
          </Typography>
        </Box>

        {links.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <People sx={{ fontSize: 40, color: 'rgba(255,255,255,0.2)', mb: 1 }} />
            <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>
              No linked funds yet. Send invitations to funds to get started.
            </Typography>
          </Box>
        ) : (
          <Grid container spacing={2}>
            {links.map((link) => {
              const pending = getPendingProposal(link.fund);
              return (
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
                    <Typography sx={{ fontSize: 15, fontWeight: 500, color: 'white' }}>
                      {link.fund.split('::')[0]}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {pending && (
                        <Chip
                          label="Proposal Pending"
                          size="small"
                          sx={{
                            bgcolor: 'rgba(245,158,11,0.2)',
                            color: '#f59e0b',
                            fontWeight: 600,
                            fontSize: 11,
                          }}
                        />
                      )}
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
                  </Box>

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box sx={{ display: 'flex', gap: 3 }}>
                      <Box>
                        <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', mb: 0.3 }}>LTV Threshold</Typography>
                        <Typography sx={{ fontSize: 20, fontWeight: 600, color: '#f59e0b' }}>
                          {(link.ltvThreshold * 100).toFixed(0)}%
                        </Typography>
                      </Box>
                      <Box>
                        <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', mb: 0.3 }}>Leverage</Typography>
                        <Chip
                          label={`${link.leverageRatio}x`}
                          size="small"
                          sx={{
                            bgcolor: link.leverageRatio > 1 ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.08)',
                            color: link.leverageRatio > 1 ? '#3b82f6' : 'rgba(255,255,255,0.5)',
                            fontWeight: 700,
                            fontSize: 14,
                          }}
                        />
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<Edit />}
                        disabled={!!pending}
                        onClick={() => {
                          setEditingLink(link);
                          setNewThreshold(link.ltvThreshold * 100);
                          setNewLeverage(link.leverageRatio);
                        }}
                        sx={{
                          borderColor: 'rgba(139,92,246,0.5)',
                          color: '#8b5cf6',
                          textTransform: 'none',
                          '&:hover': { borderColor: '#8b5cf6', bgcolor: 'rgba(139,92,246,0.1)' },
                          '&.Mui-disabled': { borderColor: 'rgba(139,92,246,0.2)', color: 'rgba(139,92,246,0.4)' },
                        }}
                      >
                        Propose Change
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<LinkOff />}
                        onClick={() => setDeactivatingLink(link)}
                        sx={{
                          borderColor: 'rgba(239,68,68,0.4)',
                          color: '#ef4444',
                          textTransform: 'none',
                          '&:hover': { borderColor: '#ef4444', bgcolor: 'rgba(239,68,68,0.1)' },
                        }}
                      >
                        Remove
                      </Button>
                    </Box>
                  </Box>

                  {/* Auto-Liquidate Toggle */}
                  <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Bolt sx={{ fontSize: 16, color: '#8b5cf6' }} />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={autoLiqPrefs[link.fund] ?? false}
                            onChange={async (e) => {
                              const newVal = e.target.checked;
                              // Optimistic update — KV reads may lag behind writes
                              setAutoLiqPrefs(prev => ({ ...prev, [link.fund]: newVal }));
                              try {
                                await linkAPI.setAutoLiquidate(partyId, link.fund, newVal);
                              } catch (error) {
                                // Revert on failure
                                setAutoLiqPrefs(prev => ({ ...prev, [link.fund]: !newVal }));
                                console.error('Error toggling auto-liquidate:', error);
                              }
                            }}
                            sx={{
                              '& .MuiSwitch-switchBase.Mui-checked': { color: '#8b5cf6' },
                              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#8b5cf6' },
                            }}
                          />
                        }
                        label={
                          <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                            Auto-Liquidate
                          </Typography>
                        }
                        sx={{ m: 0 }}
                      />
                    </Box>
                  </Box>
                  {(autoLiqPrefs[link.fund] ?? false) && (
                    <Typography sx={{ fontSize: 11, color: 'rgba(139,92,246,0.7)', mt: 0.5 }}>
                      Positions will be automatically liquidated when LTV exceeds threshold
                    </Typography>
                  )}

                  {/* Tradeable Assets */}
                  <Box sx={{ mt: 1.5, mb: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Tradeable Assets</Typography>
                      <Button
                        size="small"
                        startIcon={<Security sx={{ fontSize: 14 }} />}
                        onClick={() => {
                          setEditingAssets(link);
                          setSelectedAssets(link.allowedAssets || []);
                        }}
                        sx={{ color: '#8b5cf6', textTransform: 'none', fontSize: 11, minWidth: 'auto', py: 0 }}
                      >
                        Edit
                      </Button>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {(link.allowedAssets || []).slice(0, 6).map(asset => (
                        <Chip
                          key={asset}
                          label={asset}
                          size="small"
                          sx={{ bgcolor: 'rgba(0,212,170,0.1)', color: '#00d4aa', fontWeight: 600, fontSize: 10, height: 22 }}
                        />
                      ))}
                      {(link.allowedAssets || []).length > 6 && (
                        <Chip
                          label={`+${link.allowedAssets.length - 6}`}
                          size="small"
                          sx={{ bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', fontSize: 10, height: 22 }}
                        />
                      )}
                      {(!link.allowedAssets || link.allowedAssets.length === 0) && (
                        <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>No restrictions</Typography>
                      )}
                    </Box>
                  </Box>

                  {/* Allowed Collaterals */}
                  <Box sx={{ mb: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                      <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Allowed Collaterals</Typography>
                      <Button
                        size="small"
                        startIcon={<Security sx={{ fontSize: 14 }} />}
                        onClick={() => {
                          setEditingCollaterals(link);
                          setSelectedCollaterals(link.allowedCollaterals || []);
                        }}
                        sx={{ color: '#f59e0b', textTransform: 'none', fontSize: 11, minWidth: 'auto', py: 0 }}
                      >
                        Edit
                      </Button>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {(link.allowedCollaterals || []).slice(0, 6).map(asset => (
                        <Chip
                          key={asset}
                          label={asset}
                          size="small"
                          sx={{ bgcolor: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontWeight: 600, fontSize: 10, height: 22 }}
                        />
                      ))}
                      {(link.allowedCollaterals || []).length > 6 && (
                        <Chip
                          label={`+${link.allowedCollaterals.length - 6}`}
                          size="small"
                          sx={{ bgcolor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', fontSize: 10, height: 22 }}
                        />
                      )}
                      {(!link.allowedCollaterals || link.allowedCollaterals.length === 0) && (
                        <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>No restrictions</Typography>
                      )}
                    </Box>
                  </Box>

                  {pending && (
                    <Typography sx={{ fontSize: 11, color: '#f59e0b', mt: 1 }}>
                      Proposed: {(pending.proposedThreshold * 100).toFixed(0)}%
                      {pending.proposedLeverage != null && ` / ${pending.proposedLeverage}x leverage`}
                      {' '}(awaiting fund approval)
                    </Typography>
                  )}

                  <Typography sx={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', mt: 1 }}>
                    Linked: {new Date(link.linkedAt).toLocaleDateString()}
                  </Typography>
                </Box>
              </Grid>
              );
            })}
          </Grid>
        )}
      </Box>

      {/* Edit Threshold Dialog */}
      <Dialog
        open={!!editingLink}
        onClose={() => setEditingLink(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#111820', color: 'white' } }}
      >
        <DialogTitle>Propose LTV Change</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', mb: 1 }}>
            Fund: {editingLink?.fund.split('::')[0]}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'rgba(245,158,11,0.8)', mb: 2 }}>
            The fund must approve this change before it takes effect.
          </Typography>
          <Typography sx={{ fontSize: 14, color: 'white', mb: 1 }}>
            Threshold: {newThreshold}%
          </Typography>
          <Slider
            value={newThreshold}
            onChange={(_, val) => setNewThreshold(val as number)}
            min={50}
            max={95}
            step={5}
            marks={[
              { value: 50, label: '50%' },
              { value: 65, label: '65%' },
              { value: 80, label: '80%' },
              { value: 95, label: '95%' },
            ]}
            sx={{
              color: '#8b5cf6',
              '& .MuiSlider-markLabel': { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
            }}
          />
          <Typography sx={{ fontSize: 14, color: 'white', mt: 3, mb: 1 }}>
            Leverage Ratio: {newLeverage}x
          </Typography>
          <Slider
            value={newLeverage}
            onChange={(_, val) => setNewLeverage(val as number)}
            min={1}
            max={50}
            step={1}
            marks={[
              { value: 1, label: '1x' },
              { value: 10, label: '10x' },
              { value: 25, label: '25x' },
              { value: 50, label: '50x' },
            ]}
            sx={{
              color: '#3b82f6',
              '& .MuiSlider-markLabel': { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingLink(null)} sx={{ color: 'rgba(255,255,255,0.5)' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleUpdateThreshold}
            sx={{ bgcolor: '#8b5cf6', '&:hover': { bgcolor: '#7c3aed' } }}
          >
            Propose
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Tradeable Assets Dialog */}
      <Dialog
        open={!!editingAssets}
        onClose={() => setEditingAssets(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#111820', color: 'white' } }}
      >
        <DialogTitle>Edit Tradeable Assets</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', mb: 2 }}>
            Fund: {editingAssets?.fund.split('::')[0]} — select which assets this fund can trade.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {allAssetTypes.map(asset => {
              const isSelected = selectedAssets.includes(asset);
              return (
                <Chip
                  key={asset}
                  label={asset}
                  onClick={() => {
                    setSelectedAssets(prev =>
                      isSelected ? prev.filter(a => a !== asset) : [...prev, asset]
                    );
                  }}
                  sx={{
                    bgcolor: isSelected ? 'rgba(0,212,170,0.2)' : 'rgba(255,255,255,0.05)',
                    color: isSelected ? '#00d4aa' : 'rgba(255,255,255,0.5)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: isSelected ? '1px solid rgba(0,212,170,0.4)' : '1px solid rgba(255,255,255,0.1)',
                    '&:hover': {
                      bgcolor: isSelected ? 'rgba(0,212,170,0.3)' : 'rgba(255,255,255,0.1)',
                    },
                  }}
                />
              );
            })}
          </Box>
          <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', mt: 2 }}>
            {selectedAssets.length} asset{selectedAssets.length !== 1 ? 's' : ''} selected
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingAssets(null)} sx={{ color: 'rgba(255,255,255,0.5)' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleUpdateAllowedAssets}
            sx={{ bgcolor: '#00d4aa', color: '#0a0e14', '&:hover': { bgcolor: '#00c49a' } }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Allowed Collaterals Dialog */}
      <Dialog
        open={!!editingCollaterals}
        onClose={() => setEditingCollaterals(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#111820', color: 'white' } }}
      >
        <DialogTitle>Edit Allowed Collaterals</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', mb: 2 }}>
            Fund: {editingCollaterals?.fund.split('::')[0]} — select which assets this fund can post as collateral.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {allAssetTypes.map(asset => {
              const isSelected = selectedCollaterals.includes(asset);
              return (
                <Chip
                  key={asset}
                  label={asset}
                  onClick={() => {
                    setSelectedCollaterals(prev =>
                      isSelected ? prev.filter(a => a !== asset) : [...prev, asset]
                    );
                  }}
                  sx={{
                    bgcolor: isSelected ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)',
                    color: isSelected ? '#f59e0b' : 'rgba(255,255,255,0.5)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: isSelected ? '1px solid rgba(245,158,11,0.4)' : '1px solid rgba(255,255,255,0.1)',
                    '&:hover': {
                      bgcolor: isSelected ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.1)',
                    },
                  }}
                />
              );
            })}
          </Box>
          <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', mt: 2 }}>
            {selectedCollaterals.length} collateral{selectedCollaterals.length !== 1 ? 's' : ''} selected
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingCollaterals(null)} sx={{ color: 'rgba(255,255,255,0.5)' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleUpdateAllowedCollaterals}
            sx={{ bgcolor: '#f59e0b', color: '#0a0e14', '&:hover': { bgcolor: '#d97706' } }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deactivate Link Confirmation Dialog */}
      <Dialog
        open={!!deactivatingLink}
        onClose={() => setDeactivatingLink(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: '#111820', color: 'white' } }}
      >
        <DialogTitle sx={{ color: '#ef4444' }}>Remove Fund Link</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', mb: 2 }}>
            Are you sure you want to deactivate the link with this fund?
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
            Fund: {deactivatingLink?.fund.split('::')[0]}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'rgba(239,68,68,0.7)', mt: 1 }}>
            The fund will no longer be able to open new positions through you.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeactivatingLink(null)} sx={{ color: 'rgba(255,255,255,0.5)' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleDeactivateLink}
            sx={{ bgcolor: '#ef4444', '&:hover': { bgcolor: '#dc2626' } }}
          >
            Remove Link
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
