import { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Card, CardContent, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Chip, List, ListItem, ListItemText,
  MenuItem, Select, FormControl, InputLabel, Grid, Alert, CircularProgress
} from '@mui/material';
import { Lock, OpenInNew, AccountBalance } from '@mui/icons-material';
import { vaultAPI, getLivePrice, getCustodianParty } from '../services/api';
import { getDefaultChainId } from '../services/evmEscrow';
import type { AuthUser, Asset } from '@stratos-wallet/sdk';

interface VaultManagementProps {
  user: AuthUser;
  assets: Asset[];
}

// Default EVM chain ID for escrow deployment (driven by network mode)
const DEFAULT_EVM_CHAIN_ID = getDefaultChainId();

// Map symbol to its default chain type
function getChainType(chain: string): string {
  const map: Record<string, string> = {
    'Canton': 'canton',
    'Ethereum': 'evm',
    'Base': 'evm',
    'Polygon': 'evm',
    'Arbitrum': 'evm',
    'Solana': 'svm',
    'Bitcoin': 'btc',
    'Tron': 'tron',
    'TON': 'ton',
  };
  return map[chain] || 'evm';
}

// Build Etherscan-compatible block explorer URL
function getExplorerUrl(chain: string, address: string): string {
  const explorers: Record<string, string> = {
    'Ethereum': 'https://etherscan.io/address/',
    'Sepolia': 'https://sepolia.etherscan.io/address/',
    'Base': 'https://basescan.org/address/',
  };
  const base = explorers[chain] || 'https://sepolia.etherscan.io/address/';
  return base + address;
}

// Check if a chain vault is an EVM escrow (vs Canton custodian)
function isEVMChain(chain: string): boolean {
  return ['Ethereum', 'Sepolia', 'Base', 'Polygon', 'Arbitrum'].includes(chain) ||
    chain.startsWith('EVM-');
}

export default function VaultManagement({ user, assets }: VaultManagementProps) {
  const [vaults, setVaults] = useState<any[]>([]);
  const [custodianParty, setCustodianParty] = useState<string | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [openDeposit, setOpenDeposit] = useState(false);
  const [selectedVault, setSelectedVault] = useState<string>('');
  const [newVaultId, setNewVaultId] = useState('');
  const [depositForm, setDepositForm] = useState({
    amount: '',
    walletAssetSymbol: '',
    chain: '',
    chainType: '',
  });
  const [estimatedValue, setEstimatedValue] = useState<number | null>(null);
  const [depositStatus, setDepositStatus] = useState<'idle' | 'transferring' | 'recording' | 'done' | 'error'>('idle');
  const [depositError, setDepositError] = useState<string>('');
  const [lastTxId, setLastTxId] = useState<string>('');

  // EVM Escrow deploy state
  const [deployingEscrow, setDeployingEscrow] = useState(false);
  const [deployVaultId, setDeployVaultId] = useState<string>('');
  const [deployStatus, setDeployStatus] = useState<string>('');

  // Withdraw from escrow state
  const [openWithdraw, setOpenWithdraw] = useState(false);
  const [withdrawVaultId, setWithdrawVaultId] = useState('');
  const [withdrawChain, setWithdrawChain] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');
  const [withdrawSuccess, setWithdrawSuccess] = useState('');

  // Wallet assets from SDK
  const walletAssets = assets.filter(a => a.balance > 0);

  // Get available chains for the selected asset
  const selectedAsset = walletAssets.find(a => a.symbol === depositForm.walletAssetSymbol);
  const availableChains = selectedAsset?.chains || [];
  const chainBalances = selectedAsset?.chainBalances || {};

  // Check if the selected deposit vault has an EVM escrow matching the selected chain
  const selectedVaultData = vaults.find(v => v.vaultId === selectedVault);
  const depositChainType = depositForm.chainType || getChainType(depositForm.chain);
  const matchingEscrow = selectedVaultData?.chainVaults?.find((cv: any) =>
    isEVMChain(cv.chain) && depositChainType === 'evm'
  );

  // Get max balance for selected chain
  const getMaxBalance = () => {
    if (depositForm.chain && chainBalances[depositForm.chain] !== undefined) {
      return chainBalances[depositForm.chain];
    }
    return selectedAsset?.balance || 0;
  };

  useEffect(() => {
    loadVaults();
    getCustodianParty().then(setCustodianParty);
  }, [user]);

  const loadVaults = async () => {
    try {
      const res = await vaultAPI.getByOwner(user.partyId || user.id);
      setVaults(res.data);
    } catch (error) {
      console.error('Error loading vaults:', error);
    }
  };

  const handleCreateVault = async () => {
    try {
      await vaultAPI.create(user.partyId || user.id, newVaultId);
      setOpenCreate(false);
      setNewVaultId('');
      loadVaults();
    } catch (error) {
      console.error('Error creating vault:', error);
    }
  };

  const handleDeployEscrow = async (vaultId: string) => {
    try {
      setDeployingEscrow(true);
      setDeployVaultId(vaultId);
      setDeployStatus('Deploying escrow contract...');

      await vaultAPI.deployEVMEscrow(vaultId, DEFAULT_EVM_CHAIN_ID);

      setDeployStatus('Escrow deployed!');
      setTimeout(() => {
        setDeployingEscrow(false);
        setDeployVaultId('');
        setDeployStatus('');
        loadVaults();
      }, 2000);
    } catch (error) {
      console.error('Error deploying escrow:', error);
      setDeployStatus(`Deploy failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setTimeout(() => {
        setDeployingEscrow(false);
        setDeployVaultId('');
        setDeployStatus('');
      }, 4000);
    }
  };

  const handleWithdraw = async () => {
    try {
      setWithdrawing(true);
      setWithdrawError('');
      setWithdrawSuccess('');

      const amountWei = BigInt(Math.round(parseFloat(withdrawAmount) * 1e18)).toString();
      const result = await vaultAPI.withdrawFromEscrow(withdrawVaultId, withdrawChain, amountWei);
      setWithdrawSuccess(`Withdrawal sent (tx: ${result.data.txHash.slice(0, 20)}...)`);

      setTimeout(() => {
        setOpenWithdraw(false);
        setWithdrawAmount('');
        setWithdrawing(false);
        setWithdrawSuccess('');
        loadVaults();
      }, 2000);
    } catch (error) {
      console.error('Error withdrawing from escrow:', error);
      setWithdrawError(error instanceof Error ? error.message : 'Withdrawal failed');
      setWithdrawing(false);
    }
  };

  // Auto-select chain when asset has only one chain
  useEffect(() => {
    if (availableChains.length === 1) {
      const ac = availableChains[0];
      setDepositForm(prev => ({ ...prev, chain: ac.chain, chainType: ac.chainType || getChainType(ac.chain) }));
    } else if (availableChains.length === 0 && selectedAsset) {
      // No chains array — use asset's default chain
      const defaultChain = selectedAsset.chain || 'Canton';
      const defaultChainType = selectedAsset.chainType || getChainType(defaultChain);
      setDepositForm(prev => ({ ...prev, chain: defaultChain, chainType: defaultChainType }));
    }
  }, [depositForm.walletAssetSymbol, availableChains.length]);

  // Update estimated value when wallet asset or amount changes
  useEffect(() => {
    const updateEstimate = async () => {
      const symbol = depositForm.walletAssetSymbol;
      const amount = parseFloat(depositForm.amount);
      if (symbol && amount > 0) {
        const price = await getLivePrice(symbol);
        setEstimatedValue(amount * price);
      } else {
        setEstimatedValue(null);
      }
    };
    updateEstimate();
  }, [depositForm.walletAssetSymbol, depositForm.amount]);

  const handleDeposit = async () => {
    try {
      const amount = parseFloat(depositForm.amount);
      const symbol = depositForm.walletAssetSymbol;
      const chain = depositForm.chainType || depositForm.chain;
      if (!symbol || !chain) return;

      setDepositStatus('transferring');
      setDepositError('');
      setLastTxId('');

      const result = await vaultAPI.depositReal(
        selectedVault,
        symbol,
        amount,
        chain
      );

      setDepositStatus('done');
      if (result.txId) setLastTxId(result.txId);

      // Auto-close after brief success display
      setTimeout(() => {
        setOpenDeposit(false);
        setDepositForm({ amount: '', walletAssetSymbol: '', chain: '', chainType: '' });
        setEstimatedValue(null);
        setDepositStatus('idle');
        setLastTxId('');
        loadVaults();
      }, 2000);
    } catch (error) {
      console.error('Error depositing asset:', error);
      setDepositStatus('error');
      setDepositError(error instanceof Error ? error.message : 'Deposit failed');
    }
  };

  const handleCloseDeposit = () => {
    setOpenDeposit(false);
    setDepositForm({ amount: '', walletAssetSymbol: '', chain: '', chainType: '' });
    setEstimatedValue(null);
    setDepositStatus('idle');
    setDepositError('');
    setLastTxId('');
  };

  // Check if vault has any EVM escrow registered
  const hasEVMEscrow = (vault: any) => {
    return vault.chainVaults?.some((cv: any) => isEVMChain(cv.chain));
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3, alignItems: 'center' }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>Vault Management</Typography>
        <Button
          variant="contained"
          onClick={() => setOpenCreate(true)}
          sx={{ background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)' }}
        >
          Create New Vault
        </Button>
      </Box>

      {vaults.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Typography variant="h6" gutterBottom>No Vaults Yet</Typography>
            <Typography color="textSecondary" sx={{ mb: 2 }}>
              Create your first collateral vault to get started
            </Typography>
            <Button variant="outlined" onClick={() => setOpenCreate(true)}>
              Create Vault
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {vaults.map((vault) => (
            <Grid item xs={12} md={6} key={vault.vaultId}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                    <Typography variant="h6">{vault.vaultId}</Typography>
                    <Chip
                      label={`$${vault.totalValue.toLocaleString()}`}
                      sx={{ bgcolor: '#8b5cf6', color: 'white' }}
                    />
                  </Box>

                  {custodianParty && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5, px: 1.5, py: 0.75, bgcolor: 'rgba(0,212,170,0.05)', borderRadius: '6px', border: '1px solid rgba(0,212,170,0.15)' }}>
                      <Lock sx={{ fontSize: 14, color: '#00d4aa' }} />
                      <Typography variant="caption" sx={{ color: '#00d4aa', fontWeight: 500 }}>
                        Custodian: {custodianParty.split('::')[0]}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', ml: 0.5 }}>
                        ::{custodianParty.split('::')[1]?.slice(0, 8)}...
                      </Typography>
                    </Box>
                  )}

                  <Typography variant="body2" color="textSecondary" gutterBottom>
                    Collateral Assets ({vault.collateralAssets?.length || 0})
                  </Typography>

                  <List dense sx={{ bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1, mb: 2 }}>
                    {vault.collateralAssets?.length > 0 ? (
                      vault.collateralAssets.map((asset: any, idx: number) => (
                        <ListItem key={idx}>
                          <ListItemText
                            primary={`${asset.assetType} - ${asset.amount.toLocaleString()}`}
                            secondary={`Value: $${asset.valueUSD.toLocaleString()}`}
                          />
                        </ListItem>
                      ))
                    ) : (
                      <ListItem>
                        <ListItemText
                          primary="No assets deposited"
                          secondary="Deposit collateral to use this vault"
                        />
                      </ListItem>
                    )}
                  </List>

                  {vault.linkedPositions?.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" color="textSecondary">Linked Positions:</Typography>
                      <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                        {vault.linkedPositions.map((pos: string, idx: number) => (
                          <Chip key={idx} label={pos} size="small" variant="outlined" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {vault.depositRecords?.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" color="textSecondary">Deposit Records:</Typography>
                      <List dense sx={{ bgcolor: 'rgba(139,92,246,0.05)', borderRadius: 1, mt: 0.5 }}>
                        {vault.depositRecords.map((rec: any, idx: number) => (
                          <ListItem key={idx} sx={{ py: 0.25 }}>
                            <ListItemText
                              primary={`${rec.symbol} ${rec.amount} via ${rec.chain}`}
                              secondary={rec.txId ? `tx: ${rec.txId.slice(0, 16)}...` : undefined}
                              primaryTypographyProps={{ variant: 'caption' }}
                              secondaryTypographyProps={{ variant: 'caption', sx: { fontFamily: 'monospace', fontSize: '0.65rem' } }}
                            />
                          </ListItem>
                        ))}
                      </List>
                    </Box>
                  )}

                  {/* Chain Custody — differentiate Canton custodian vs EVM escrow */}
                  {vault.chainVaults?.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" color="textSecondary">Chain Custody:</Typography>
                      <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                        {vault.chainVaults.map((cv: any, idx: number) => {
                          const isEvm = isEVMChain(cv.chain);
                          return (
                            <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Chip
                                icon={isEvm ? <AccountBalance sx={{ fontSize: 14 }} /> : <Lock sx={{ fontSize: 14 }} />}
                                label={`${cv.chain}: ${cv.custodyAddress.slice(0, 12)}...`}
                                size="small"
                                variant="outlined"
                                component="a"
                                href={isEvm ? getExplorerUrl(cv.chain, cv.custodyAddress) : undefined}
                                target="_blank"
                                rel="noopener noreferrer"
                                clickable={isEvm}
                                deleteIcon={isEvm ? <OpenInNew sx={{ fontSize: 12 }} /> : undefined}
                                onDelete={isEvm ? () => window.open(getExplorerUrl(cv.chain, cv.custodyAddress), '_blank') : undefined}
                                sx={{
                                  fontFamily: 'monospace',
                                  fontSize: '0.7rem',
                                  borderColor: isEvm ? 'rgba(139,92,246,0.4)' : 'rgba(0,212,170,0.3)',
                                  color: isEvm ? '#a78bfa' : '#00d4aa',
                                }}
                              />
                              {isEvm && (
                                <Button
                                  size="small"
                                  variant="text"
                                  sx={{ minWidth: 'auto', fontSize: '0.65rem', py: 0, px: 0.5, color: '#f59e0b' }}
                                  onClick={() => {
                                    setWithdrawVaultId(vault.vaultId);
                                    setWithdrawChain(cv.chain);
                                    setOpenWithdraw(true);
                                  }}
                                >
                                  Withdraw
                                </Button>
                              )}
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      variant="outlined"
                      fullWidth
                      onClick={() => {
                        setSelectedVault(vault.vaultId);
                        setOpenDeposit(true);
                      }}
                    >
                      Deposit Asset
                    </Button>

                    {!hasEVMEscrow(vault) && (
                      <Button
                        variant="outlined"
                        fullWidth
                        disabled={deployingEscrow}
                        onClick={() => handleDeployEscrow(vault.vaultId)}
                        sx={{
                          borderColor: 'rgba(139,92,246,0.5)',
                          color: '#a78bfa',
                          '&:hover': { borderColor: '#8b5cf6', bgcolor: 'rgba(139,92,246,0.08)' },
                        }}
                      >
                        {deployingEscrow && deployVaultId === vault.vaultId
                          ? <CircularProgress size={16} sx={{ mr: 1 }} />
                          : <AccountBalance sx={{ fontSize: 16, mr: 0.5 }} />}
                        {deployingEscrow && deployVaultId === vault.vaultId
                          ? 'Deploying...'
                          : 'Deploy EVM Escrow'}
                      </Button>
                    )}
                  </Box>

                  {/* Deploy status message */}
                  {deployVaultId === vault.vaultId && deployStatus && (
                    <Alert
                      severity={deployStatus.includes('failed') ? 'error' : deployStatus.includes('deployed') ? 'success' : 'info'}
                      sx={{ mt: 1 }}
                    >
                      {deployStatus}
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Create Vault Dialog */}
      <Dialog open={openCreate} onClose={() => setOpenCreate(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Vault</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Vault ID"
            placeholder="e.g., VAULT-001"
            fullWidth
            value={newVaultId}
            onChange={(e) => setNewVaultId(e.target.value)}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCreate(false)}>Cancel</Button>
          <Button onClick={handleCreateVault} variant="contained" disabled={!newVaultId}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deposit Dialog */}
      <Dialog open={openDeposit} onClose={handleCloseDeposit} maxWidth="sm" fullWidth>
        <DialogTitle>Deposit Asset to {selectedVault}</DialogTitle>
        <DialogContent>
          {depositStatus === 'done' ? (
            <Alert severity="success" sx={{ mt: 1 }}>
              Deposit confirmed{lastTxId ? ` (tx: ${lastTxId.slice(0, 20)}...)` : ''}
            </Alert>
          ) : depositStatus === 'error' ? (
            <Alert severity="error" sx={{ mt: 1 }}>{depositError}</Alert>
          ) : depositStatus !== 'idle' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2, mb: 2 }}>
              <CircularProgress size={24} />
              <Typography variant="body2">
                {depositStatus === 'transferring'
                  ? (matchingEscrow
                    ? 'Sending to EVM escrow contract...'
                    : custodianParty
                      ? 'Transferring tokens to vault custodian...'
                      : 'Transferring tokens to vault custody...')
                  : 'Recording deposit on ledger...'}
              </Typography>
            </Box>
          ) : null}

          <FormControl fullWidth margin="dense" sx={{ mt: 1 }} disabled={depositStatus !== 'idle'}>
            <InputLabel>Wallet Asset</InputLabel>
            <Select
              value={depositForm.walletAssetSymbol}
              label="Wallet Asset"
              onChange={(e) => setDepositForm({ ...depositForm, walletAssetSymbol: e.target.value, amount: '', chain: '', chainType: '' })}
            >
              {walletAssets.length > 0 ? (
                walletAssets.map((a) => (
                  <MenuItem key={a.symbol} value={a.symbol}>
                    {a.symbol} &mdash; Balance: {a.balance.toLocaleString()}
                  </MenuItem>
                ))
              ) : (
                <MenuItem disabled value="">No wallet assets available</MenuItem>
              )}
            </Select>
          </FormControl>

          {/* Chain selection — shown when asset has multiple chains */}
          {availableChains.length > 1 && (
            <FormControl fullWidth margin="dense" disabled={depositStatus !== 'idle'}>
              <InputLabel>Chain</InputLabel>
              <Select
                value={depositForm.chain}
                label="Chain"
                onChange={(e) => {
                  const selected = availableChains.find(c => c.chain === e.target.value);
                  setDepositForm({
                    ...depositForm,
                    chain: e.target.value,
                    chainType: selected?.chainType || getChainType(e.target.value),
                    amount: '',
                  });
                }}
              >
                {availableChains.map((ac) => (
                  <MenuItem key={ac.chain} value={ac.chain}>
                    {ac.chain}
                    {chainBalances[ac.chain] !== undefined ? ` — ${chainBalances[ac.chain].toLocaleString()} ${depositForm.walletAssetSymbol}` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <TextField
            margin="dense"
            label="Amount"
            type="number"
            fullWidth
            disabled={depositStatus !== 'idle'}
            value={depositForm.amount}
            onChange={(e) => {
              const maxBal = getMaxBalance();
              const val = Math.min(parseFloat(e.target.value) || 0, maxBal);
              setDepositForm({ ...depositForm, amount: val > 0 ? val.toString() : e.target.value });
            }}
            helperText={
              depositForm.walletAssetSymbol
                ? `Max: ${getMaxBalance().toLocaleString()}${depositForm.chain ? ` (${depositForm.chain})` : ''}`
                : 'Select an asset first'
            }
          />

          {estimatedValue !== null && estimatedValue > 0 && (
            <Box sx={{ mt: 1, p: 1.5, bgcolor: 'rgba(0,212,170,0.05)', borderRadius: '8px', border: '1px solid rgba(0,212,170,0.2)' }}>
              <Typography variant="body2" sx={{ color: '#00d4aa', fontWeight: 500 }}>
                Estimated Value: ${estimatedValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </Typography>
              {matchingEscrow ? (
                <Typography variant="caption" sx={{ color: '#a78bfa' }}>
                  Tokens will be sent to vault escrow contract: {matchingEscrow.custodyAddress.slice(0, 20)}...
                </Typography>
              ) : (
                <Typography variant="caption" color="textSecondary">
                  Tokens will be transferred to {custodianParty ? 'vault custodian' : 'vault custody'} on {depositForm.chain || 'selected chain'}
                </Typography>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDeposit} disabled={depositStatus === 'transferring' || depositStatus === 'recording'}>
            Cancel
          </Button>
          <Button
            onClick={handleDeposit}
            variant="contained"
            disabled={
              depositStatus !== 'idle' ||
              !depositForm.amount || parseFloat(depositForm.amount) <= 0 ||
              !depositForm.walletAssetSymbol ||
              (!depositForm.chain && availableChains.length > 1)
            }
          >
            Deposit
          </Button>
        </DialogActions>
      </Dialog>

      {/* Withdraw from Escrow Dialog */}
      <Dialog open={openWithdraw} onClose={() => { setOpenWithdraw(false); setWithdrawAmount(''); setWithdrawError(''); setWithdrawSuccess(''); }} maxWidth="sm" fullWidth>
        <DialogTitle>Withdraw from Escrow</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            Withdraw ETH from the escrow contract on {withdrawChain} back to your wallet.
          </Typography>

          {withdrawSuccess && <Alert severity="success" sx={{ mb: 1 }}>{withdrawSuccess}</Alert>}
          {withdrawError && <Alert severity="error" sx={{ mb: 1 }}>{withdrawError}</Alert>}

          <TextField
            autoFocus
            margin="dense"
            label="Amount (ETH)"
            type="number"
            fullWidth
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            disabled={withdrawing}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setOpenWithdraw(false); setWithdrawAmount(''); setWithdrawError(''); setWithdrawSuccess(''); }} disabled={withdrawing}>
            Cancel
          </Button>
          <Button
            onClick={handleWithdraw}
            variant="contained"
            disabled={withdrawing || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
            sx={{ bgcolor: '#f59e0b', '&:hover': { bgcolor: '#d97706' } }}
          >
            {withdrawing ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
            Withdraw
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
