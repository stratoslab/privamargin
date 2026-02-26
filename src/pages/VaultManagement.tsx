import { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Card, CardContent, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Chip, List, ListItem, ListItemText,
  MenuItem, Select, FormControl, InputLabel, Grid, Alert, CircularProgress
} from '@mui/material';
import { Lock, OpenInNew, AccountBalance, Warning } from '@mui/icons-material';
import { vaultAPI, getLivePrice, getCustodianParty, displaySymbol } from '../services/api';
import TokenIcon from '../components/TokenIcon';
import { getDefaultChainId, CHAIN_NAME_TO_ID, CHAIN_CONFIG, isSameChain, isEVMChain, resolveChainId } from '../services/evmEscrow';
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
  const chainId = resolveChainId(chain);
  const explorers: Record<number, string> = {
    1: 'https://etherscan.io/address/',
    11155111: 'https://sepolia.etherscan.io/address/',
    8453: 'https://basescan.org/address/',
    84532: 'https://sepolia.basescan.org/address/',
  };
  const base = chainId ? (explorers[chainId] || 'https://sepolia.etherscan.io/address/') : 'https://sepolia.etherscan.io/address/';
  return base + address;
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
  const [deployStatus, setDeployStatus] = useState<string>('');

  // Withdraw from escrow state
  const [openWithdraw, setOpenWithdraw] = useState(false);
  const [withdrawVaultId, setWithdrawVaultId] = useState('');
  const [withdrawChain, setWithdrawChain] = useState('');
  const [withdrawAssetSymbol, setWithdrawAssetSymbol] = useState('');
  const [withdrawMaxAmount, setWithdrawMaxAmount] = useState(0);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawChainOptions, setWithdrawChainOptions] = useState<Array<{ chain: string; balance: number }>>([]);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');
  const [withdrawSuccess, setWithdrawSuccess] = useState('');

  // Close vault state
  const [closingVault, setClosingVault] = useState<string | null>(null);
  const [closeStatus, setCloseStatus] = useState('');

  // Sync escrow state
  const [syncingVault, setSyncingVault] = useState<string | null>(null);

  // Wallet assets from SDK
  const walletAssets = assets.filter(a => a.balance > 0);

  // Get available chains for the selected asset
  const selectedAsset = walletAssets.find(a => a.symbol === depositForm.walletAssetSymbol);
  const availableChains = selectedAsset?.chains || [];
  const chainBalances = selectedAsset?.chainBalances || {};

  // Check if the selected deposit vault has an EVM escrow matching the selected chain
  const selectedVaultData = vaults.find(v => v.vaultId === selectedVault);
  const depositChainType = depositForm.chainType || getChainType(depositForm.chain);
  const selectedChainName = depositForm.chain;
  const matchingEscrow = selectedVaultData?.chainVaults?.find((cv: any) =>
    selectedChainName && isSameChain(cv.chain, selectedChainName)
  );

  const isCanton = depositChainType === 'canton';
  const needsEscrow = !isCanton && depositForm.chain && !matchingEscrow;
  const selectedChainId = selectedChainName ? CHAIN_NAME_TO_ID[selectedChainName] : undefined;

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

  const handleDeployEscrow = async (vaultId: string, chainId?: number, chainName?: string) => {
    try {
      setDeployingEscrow(true);
      setDeployStatus('Deploying escrow contract...');

      await vaultAPI.deployEVMEscrow(vaultId, chainId || DEFAULT_EVM_CHAIN_ID, undefined, chainName);

      setDeployStatus('Escrow deployed!');
      setTimeout(() => {
        setDeployingEscrow(false);
        setDeployStatus('');
        loadVaults();
      }, 2000);
    } catch (error) {
      console.error('Error deploying escrow:', error);
      setDeployStatus(`Deploy failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setTimeout(() => {
        setDeployingEscrow(false);
        setDeployStatus('');
      }, 4000);
    }
  };

  const handleWithdraw = async () => {
    try {
      setWithdrawing(true);
      setWithdrawError('');
      setWithdrawSuccess('');

      if (withdrawChain === 'Canton') {
        // CC withdrawal: exercise WithdrawAsset on the vault (returns CC to owner)
        const amount = parseFloat(withdrawAmount);
        await vaultAPI.withdrawCantonAsset(withdrawVaultId, withdrawAssetSymbol, amount);
        setWithdrawSuccess(`Withdrew ${withdrawAmount} ${displaySymbol(withdrawAssetSymbol)} from vault`);
      } else {
        // EVM withdrawal: withdraw from escrow contract
        const isStablecoin = ['USDC', 'USDT'].includes(withdrawAssetSymbol);
        const decimals = isStablecoin ? 6 : 18;
        const amountSmallest = BigInt(Math.round(parseFloat(withdrawAmount) * 10 ** decimals)).toString();

        // For ERC20 tokens (USDC), pass the token contract address
        const chainId = CHAIN_NAME_TO_ID[withdrawChain];
        const tokenAddress = isStablecoin && chainId
          ? CHAIN_CONFIG[chainId]?.usdc
          : undefined;

        const result = await vaultAPI.withdrawFromEscrow(withdrawVaultId, withdrawChain, amountSmallest, tokenAddress, withdrawAssetSymbol);
        setWithdrawSuccess(`Withdrawal sent (tx: ${result.data.txHash.slice(0, 20)}...)`);
      }

      setTimeout(() => {
        setOpenWithdraw(false);
        setWithdrawAmount('');
        setWithdrawing(false);
        setWithdrawSuccess('');
        loadVaults();
      }, 2000);
    } catch (error) {
      console.error('Error withdrawing:', error);
      setWithdrawError(error instanceof Error ? error.message : 'Withdrawal failed');
      setWithdrawing(false);
    }
  };

  const handleCloseVault = async (vaultId: string) => {
    try {
      setClosingVault(vaultId);
      const vault = vaults.find(v => v.vaultId === vaultId);
      if (!vault) throw new Error('Vault not found');

      // Step 1: Withdraw all Canton-held assets back to user via custodian
      // This includes CC, CUSDC, and USDC deposited via Canton
      const cantonAssets = (vault.collateralAssets || []).filter((a: any) =>
        a.assetType === 'CC' || a.assetType === 'CantonCoin' ||
        a.assetType === 'CUSDC' || a.assetType === 'USDC'
      );
      for (const asset of cantonAssets) {
        // Skip USDC if it was deposited via EVM (has EVM escrow entries), not Canton
        if (asset.assetType === 'USDC') {
          const cantonUsdcBal = vault.chainBalancesBySymbol?.['USDC']?.['Canton'] || vault.chainBalancesBySymbol?.['USDC']?.['canton'] || 0;
          if (cantonUsdcBal <= 0) continue; // no Canton USDC, skip (it's EVM-held)
        }
        try {
          setCloseStatus(`Returning ${asset.amount} ${displaySymbol(asset.assetType)} to wallet...`);
          await vaultAPI.withdrawCantonAsset(vaultId, asset.assetType, asset.amount);
        } catch (err) {
          console.warn(`${asset.assetType} withdraw failed (may already be returned):`, err);
        }
      }

      // Step 2: Withdraw all funds from each EVM escrow (ETH + USDC)
      for (const cv of (vault.chainVaults || [])) {
        if (!isEVMChain(cv.chain)) continue;
        const chainId = CHAIN_NAME_TO_ID[cv.chain];
        if (!chainId) continue;

        // Read on-chain balances
        try {
          setCloseStatus(`Reading ${cv.chain} escrow balances...`);
          const balRes = await fetch(`/api/escrow/balances?address=${cv.custodyAddress}&chainId=${chainId}`);
          if (!balRes.ok) continue;
          const bal = await balRes.json() as { eth: string; usdc: string };

          // Withdraw ETH if any
          if (BigInt(bal.eth) > 0n) {
            try {
              setCloseStatus(`Withdrawing ETH from ${cv.chain} escrow...`);
              await vaultAPI.withdrawFromEscrow(vaultId, cv.chain, bal.eth);
            } catch (err) {
              console.warn(`ETH withdraw from ${cv.chain} failed:`, err);
            }
          }

          // Withdraw USDC if any
          if (BigInt(bal.usdc) > 0n) {
            try {
              setCloseStatus(`Withdrawing USDC from ${cv.chain} escrow...`);
              const usdcAddr = CHAIN_CONFIG[chainId]?.usdc;
              if (usdcAddr) {
                await vaultAPI.withdrawFromEscrow(vaultId, cv.chain, bal.usdc, usdcAddr);
              }
            } catch (err) {
              console.warn(`USDC withdraw from ${cv.chain} failed:`, err);
            }
          }
        } catch (err) {
          console.warn(`Failed to read ${cv.chain} escrow balances:`, err);
        }
      }

      // Step 3: Archive the vault contract on Canton
      setCloseStatus('Archiving vault on ledger...');
      await vaultAPI.closeVault(vaultId);

      setCloseStatus('Vault closed successfully');
      setTimeout(() => {
        setClosingVault(null);
        setCloseStatus('');
        loadVaults();
      }, 2000);
    } catch (error) {
      console.error('Error closing vault:', error);
      setCloseStatus(`Close failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setTimeout(() => {
        setClosingVault(null);
        setCloseStatus('');
      }, 4000);
    }
  };

  const handleSyncEscrow = async (vaultId: string) => {
    try {
      setSyncingVault(vaultId);
      const result = await vaultAPI.syncEscrowDeposits(vaultId);
      if (result.synced?.length) {
        console.log('[Sync] Synced deposits:', result.synced);
      }
      await loadVaults();
    } catch (error) {
      console.error('Sync escrow error:', error);
    } finally {
      setSyncingVault(null);
    }
  };

  // Auto-select chain when asset has only one chain
  useEffect(() => {
    if (availableChains.length === 1) {
      const ac = availableChains[0];
      setDepositForm(prev => ({ ...prev, chain: ac.chain, chainType: ac.chainType || getChainType(ac.chain) }));
    } else if (availableChains.length === 0 && selectedAsset) {
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
        chain,
        depositForm.chain  // specific chain name: 'Ethereum', 'Base', 'Canton'
      );

      setDepositStatus('done');
      if (result.txId) setLastTxId(result.txId);

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

  // Determine which chains an asset can be withdrawn from, with per-chain balances
  const getAssetWithdrawChains = (vault: any, asset: any): Array<{ chain: string; balance: number }> => {
    const symbol = asset.assetType || asset.symbol;
    // Canton-native (CC, CUSDC) assets are always withdrawn via Canton custodian
    if (symbol === 'CC' || symbol === 'CUSDC') {
      return [{ chain: 'Canton', balance: asset.amount }];
    }

    // Accumulate per-chain using a map to avoid duplicates (e.g. 'canton' + 'Canton')
    const chainMap = new Map<string, number>();
    const chainBals = vault.chainBalancesBySymbol?.[symbol] as Record<string, number> | undefined;
    const evmEscrows: any[] = (vault.chainVaults || []).filter((cv: any) => isEVMChain(cv.chain));

    if (chainBals) {
      for (const [chain, balance] of Object.entries(chainBals)) {
        if (balance <= 0) continue;

        // Canton-held (chain = 'canton' or 'Canton') — normalize to 'Canton'
        if (chain.toLowerCase() === 'canton') {
          chainMap.set('Canton', (chainMap.get('Canton') || 0) + balance);
          continue;
        }

        // Specific EVM chain name (e.g. 'Ethereum', 'Base') — match against escrow
        if (evmEscrows.some((cv: any) => cv.chain === chain)) {
          chainMap.set(chain, (chainMap.get(chain) || 0) + balance);
          continue;
        }

        // Legacy generic 'evm' — map to available escrows that don't already have specific entries
        if (chain === 'evm') {
          const escrowsWithoutSpecific = evmEscrows.filter((cv: any) => !chainBals[cv.chain]);
          if (escrowsWithoutSpecific.length === 1) {
            chainMap.set(escrowsWithoutSpecific[0].chain, (chainMap.get(escrowsWithoutSpecific[0].chain) || 0) + balance);
          } else if (escrowsWithoutSpecific.length > 1) {
            for (const cv of escrowsWithoutSpecific) {
              chainMap.set(cv.chain, (chainMap.get(cv.chain) || 0) + balance);
            }
          }
        }
      }
    }

    // If chainMap is still empty (no deposit records, or chain names didn't match),
    // fall back: show EVM escrows if any, otherwise offer Canton withdraw
    if (chainMap.size === 0) {
      if (evmEscrows.length > 0) {
        for (const cv of evmEscrows) {
          chainMap.set(cv.chain, asset.amount);
        }
      } else if (asset.amount > 0) {
        chainMap.set('Canton', asset.amount);
      }
    }

    // Cap chain balances so their sum doesn't exceed the actual asset amount.
    // depositRecords are append-only (not cleaned up on withdrawal), so chainBalancesBySymbol
    // can overstate balances after withdrawals. Scale down proportionally if needed.
    const totalChain = Array.from(chainMap.values()).reduce((s, v) => s + v, 0);
    if (totalChain > asset.amount + 0.01) {
      const scale = asset.amount / totalChain;
      for (const [key, val] of chainMap) {
        chainMap.set(key, Math.max(0, val * scale));
      }
    }

    return Array.from(chainMap.entries())
      .filter(([, balance]) => balance > 0.001)
      .map(([chain, balance]) => ({ chain, balance }));
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

                  <Typography variant="body2" color="textSecondary" gutterBottom>
                    Collateral Assets ({vault.collateralAssets?.length || 0})
                  </Typography>

                  <List dense sx={{ bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1, mb: 2 }}>
                    {vault.collateralAssets?.length > 0 ? (
                      vault.collateralAssets.map((asset: any, idx: number) => {
                        const chainOptions = getAssetWithdrawChains(vault, asset);
                        const canWithdraw = chainOptions.length > 0;
                        return (
                          <ListItem
                            key={idx}
                            sx={{
                              cursor: canWithdraw ? 'pointer' : 'default',
                              '&:hover': canWithdraw ? { bgcolor: 'rgba(139,92,246,0.08)' } : {},
                              borderRadius: 1,
                            }}
                            onClick={() => {
                              if (!canWithdraw) return;
                              setWithdrawVaultId(vault.vaultId);
                              setWithdrawAssetSymbol(asset.assetType || asset.symbol || '');
                              if (chainOptions.length === 1) {
                                // Single chain: auto-select
                                setWithdrawChain(chainOptions[0].chain);
                                setWithdrawMaxAmount(chainOptions[0].balance);
                                setWithdrawChainOptions([]);
                              } else {
                                // Multiple chains: show selector in dialog
                                setWithdrawChainOptions(chainOptions);
                                setWithdrawChain('');
                                setWithdrawMaxAmount(0);
                              }
                              setOpenWithdraw(true);
                            }}
                          >
                            <ListItemText
                              primary={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <TokenIcon symbol={asset.assetType} size={20} />
                                  <span>{displaySymbol(asset.assetType)} — {asset.amount.toLocaleString(undefined, { maximumFractionDigits: 5 })}</span>
                                  {canWithdraw && (
                                    <Chip
                                      label="Withdraw"
                                      size="small"
                                      sx={{ fontSize: '0.6rem', height: 18, bgcolor: 'rgba(245,158,11,0.15)', color: '#f59e0b', cursor: 'pointer' }}
                                    />
                                  )}
                                </Box>
                              }
                              secondary={`Value: $${asset.valueUSD.toLocaleString()}`}
                            />
                          </ListItem>
                        );
                      })
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

                  {/* Chain Custody — show escrow addresses */}
                  {vault.chainVaults?.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" color="textSecondary">Escrow Addresses:</Typography>
                      <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                        {vault.chainVaults.map((cv: any, idx: number) => {
                          const isEvm = isEVMChain(cv.chain);
                          return (
                            <Chip
                              key={idx}
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
                    {vault.chainVaults?.some((cv: any) => isEVMChain(cv.chain)) && (
                      <Button
                        variant="outlined"
                        fullWidth
                        disabled={syncingVault === vault.vaultId}
                        onClick={() => handleSyncEscrow(vault.vaultId)}
                        sx={{
                          borderColor: 'rgba(0,212,170,0.5)',
                          color: '#00d4aa',
                          '&:hover': { borderColor: '#00d4aa', bgcolor: 'rgba(0,212,170,0.08)' },
                        }}
                      >
                        {syncingVault === vault.vaultId ? (
                          <><CircularProgress size={14} sx={{ mr: 1 }} /> Syncing...</>
                        ) : (
                          'Sync Balances'
                        )}
                      </Button>
                    )}
                    <Button
                      variant="outlined"
                      fullWidth
                      color="error"
                      disabled={closingVault === vault.vaultId}
                      onClick={() => handleCloseVault(vault.vaultId)}
                      sx={{
                        borderColor: 'rgba(239,68,68,0.5)',
                        color: '#ef4444',
                        '&:hover': { borderColor: '#ef4444', bgcolor: 'rgba(239,68,68,0.08)' },
                      }}
                    >
                      {closingVault === vault.vaultId ? (
                        <><CircularProgress size={14} sx={{ mr: 1 }} /> {closeStatus.split('...')[0]}...</>
                      ) : (
                        <>
                          <Warning sx={{ fontSize: 16, mr: 0.5 }} /> Close Vault
                        </>
                      )}
                    </Button>
                  </Box>
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
                    {a.symbol} &mdash; Balance: {a.balance.toLocaleString(undefined, { maximumFractionDigits: 5 })}
                  </MenuItem>
                ))
              ) : (
                <MenuItem disabled value="">No wallet assets available</MenuItem>
              )}
            </Select>
          </FormControl>

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
                    {chainBalances[ac.chain] !== undefined ? ` — ${chainBalances[ac.chain].toLocaleString(undefined, { maximumFractionDigits: 5 })} ${depositForm.walletAssetSymbol}` : ''}
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
                ? `Max: ${getMaxBalance().toLocaleString(undefined, { maximumFractionDigits: 5 })}${depositForm.chain ? ` (${depositForm.chain})` : ''}`
                : 'Select an asset first'
            }
          />

          {needsEscrow && (
            <Box sx={{ mt: 1, p: 1.5, bgcolor: 'rgba(139,92,246,0.05)', borderRadius: '8px', border: '1px solid rgba(139,92,246,0.3)' }}>
              <Typography variant="body2" sx={{ color: '#a78bfa', mb: 1 }}>
                No escrow deployed for {depositForm.chain}
              </Typography>
              <Button
                variant="outlined"
                size="small"
                disabled={deployingEscrow}
                onClick={() => handleDeployEscrow(selectedVault, selectedChainId, depositForm.chain)}
                sx={{
                  borderColor: 'rgba(139,92,246,0.5)',
                  color: '#a78bfa',
                  '&:hover': { borderColor: '#8b5cf6', bgcolor: 'rgba(139,92,246,0.08)' },
                }}
              >
                {deployingEscrow
                  ? <><CircularProgress size={14} sx={{ mr: 1 }} /> Deploying...</>
                  : <><AccountBalance sx={{ fontSize: 14, mr: 0.5 }} /> Deploy {depositForm.chain} Escrow</>}
              </Button>
              {deployStatus && (
                <Alert
                  severity={deployStatus.includes('failed') ? 'error' : deployStatus.includes('deployed') ? 'success' : 'info'}
                  sx={{ mt: 1 }}
                >
                  {deployStatus}
                </Alert>
              )}
            </Box>
          )}

          {estimatedValue !== null && estimatedValue > 0 && !needsEscrow && (
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
              !!needsEscrow ||
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

      {/* Withdraw Asset Dialog */}
      <Dialog open={openWithdraw} onClose={() => { setOpenWithdraw(false); setWithdrawAmount(''); setWithdrawError(''); setWithdrawSuccess(''); setWithdrawChainOptions([]); }} maxWidth="sm" fullWidth>
        <DialogTitle>Withdraw {displaySymbol(withdrawAssetSymbol)}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            Withdraw {displaySymbol(withdrawAssetSymbol)} from {withdrawChain ? (withdrawChain === 'Canton' ? 'Canton custodian' : `${withdrawChain} escrow`) : 'escrow'} back to your wallet.
          </Typography>

          {withdrawSuccess && <Alert severity="success" sx={{ mb: 1 }}>{withdrawSuccess}</Alert>}
          {withdrawError && <Alert severity="error" sx={{ mb: 1 }}>{withdrawError}</Alert>}

          {withdrawChainOptions.length > 1 && (
            <FormControl fullWidth margin="dense" disabled={withdrawing}>
              <InputLabel>Chain</InputLabel>
              <Select
                value={withdrawChain}
                label="Chain"
                onChange={(e) => {
                  const selected = withdrawChainOptions.find(o => o.chain === e.target.value);
                  setWithdrawChain(e.target.value);
                  setWithdrawMaxAmount(selected?.balance || 0);
                  setWithdrawAmount('');
                }}
              >
                {withdrawChainOptions.map((opt) => (
                  <MenuItem key={opt.chain} value={opt.chain}>
                    {opt.chain} — {opt.balance.toLocaleString(undefined, { maximumFractionDigits: 5 })} {displaySymbol(withdrawAssetSymbol)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <TextField
            autoFocus={withdrawChainOptions.length <= 1}
            margin="dense"
            label={`Amount (${displaySymbol(withdrawAssetSymbol)})`}
            type="number"
            fullWidth
            value={withdrawAmount}
            onChange={(e) => {
              const val = Math.min(parseFloat(e.target.value) || 0, withdrawMaxAmount);
              setWithdrawAmount(val > 0 ? val.toString() : e.target.value);
            }}
            disabled={withdrawing || (withdrawChainOptions.length > 1 && !withdrawChain)}
            helperText={`Available: ${withdrawMaxAmount.toLocaleString(undefined, { maximumFractionDigits: 5 })} ${displaySymbol(withdrawAssetSymbol)}`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setOpenWithdraw(false); setWithdrawAmount(''); setWithdrawError(''); setWithdrawSuccess(''); setWithdrawChainOptions([]); }} disabled={withdrawing}>
            Cancel
          </Button>
          <Button
            onClick={handleWithdraw}
            variant="contained"
            disabled={withdrawing || !withdrawChain || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
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
