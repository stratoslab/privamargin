import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Box, Typography, Button, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, Grid,
  MenuItem, Select, FormControl, InputLabel, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Chip
} from '@mui/material';
import { Add, Download, AccountBalanceWallet } from '@mui/icons-material';
import { vaultAPI } from '../services/api';
import type { AuthUser, Asset } from '@stratos-wallet/sdk';

interface AssetsProps {
  user: AuthUser;
  assets: Asset[];
}

interface AssetPrice {
  symbol: string;
  name: string;
  description: string;
  logo: string;
  price: number;
}

interface UserAsset {
  contractId: string;
  assetId: string;
  assetType: string;
  amount: number;
  valueUSD: number;
}

export default function Assets({ user, assets }: AssetsProps) {
  const location = useLocation();
  const [assetPrices, setAssetPrices] = useState<AssetPrice[]>([]);
  const [userAssets, setUserAssets] = useState<UserAsset[]>([]);
  const [vaults, setVaults] = useState<any[]>([]);
  const [openTransfer, setOpenTransfer] = useState(false);
  const [openDeposit, setOpenDeposit] = useState(false);
  const [selectedUserAsset, setSelectedUserAsset] = useState<UserAsset | null>(null);
  const [transferForm, setTransferForm] = useState({
    assetType: 'CC',
    amount: ''
  });
  const [depositVaultId, setDepositVaultId] = useState('');

  // Suppress unused variable warning
  void assets;

  // Refetch data when navigating to this tab
  useEffect(() => {
    loadData();
  }, [user, location.pathname]);

  const loadData = async () => {
    try {
      // Fetch prices from API with cache-busting
      const pricesRes = await fetch(`/api/prices?t=${Date.now()}`);
      const pricesData = await pricesRes.json() as { assets?: AssetPrice[] };
      setAssetPrices(pricesData.assets || []);

      // Fetch user's available assets
      const userAssetsRes = await vaultAPI.getAvailableAssets(user.partyId || user.id);
      setUserAssets(userAssetsRes.data);

      // Fetch vaults for deposit
      const vaultsRes = await vaultAPI.getByOwner(user.partyId || user.id);
      setVaults(vaultsRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const handleDemoTransfer = async () => {
    try {
      await vaultAPI.mintAsset(
        user.partyId || user.id,
        transferForm.assetType,
        parseFloat(transferForm.amount)
      );
      setOpenTransfer(false);
      setTransferForm({ assetType: 'CC', amount: '' });
      loadData();
    } catch (error) {
      console.error('Error minting asset:', error);
    }
  };

  const handleDepositToVault = async () => {
    if (!selectedUserAsset || !depositVaultId) return;
    try {
      await vaultAPI.deposit(depositVaultId, selectedUserAsset.contractId);
      setOpenDeposit(false);
      setSelectedUserAsset(null);
      setDepositVaultId('');
      loadData();
    } catch (error) {
      console.error('Error depositing to vault:', error);
    }
  };

  const formatPrice = (price: number): string => {
    if (price >= 1000) {
      return `$${price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
    if (price >= 1) {
      return `$${price.toFixed(2)}`;
    }
    return `$${price.toFixed(4)}`;
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
        <Box>
          <Typography sx={{ fontSize: 28, fontWeight: 600, color: '#00d4aa', mb: 0.5, fontFamily: '"Outfit", sans-serif' }}>
            Assets
          </Typography>
          <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', fontFamily: '"Outfit", sans-serif' }}>
            Manage your tokenized assets
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<Download />}
            sx={{
              borderColor: 'rgba(255,255,255,0.2)',
              color: 'white',
              fontWeight: 500,
              px: 2.5,
              py: 1,
              borderRadius: '8px',
              textTransform: 'none',
              fontFamily: '"Outfit", sans-serif',
              '&:hover': { borderColor: 'rgba(255,255,255,0.4)' },
            }}
          >
            Receive
          </Button>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setOpenTransfer(true)}
            sx={{
              bgcolor: '#00d4aa',
              color: '#0a0e14',
              fontWeight: 600,
              px: 2.5,
              py: 1,
              borderRadius: '8px',
              textTransform: 'none',
              fontFamily: '"Outfit", sans-serif',
              '&:hover': { bgcolor: '#00c49a' },
            }}
          >
            Demo Transfer
          </Button>
        </Box>
      </Box>

      {/* Asset Price Cards Grid */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {assetPrices.map((asset) => (
          <Grid item xs={12} sm={6} md={3} key={asset.symbol}>
            <Box
              sx={{
                bgcolor: '#111820',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.06)',
                p: 2.5,
                '&:hover': { borderColor: 'rgba(0, 212, 170, 0.3)' },
                transition: 'border-color 0.2s',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                <Box
                  component="img"
                  src={asset.logo}
                  alt={asset.symbol}
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    bgcolor: 'rgba(255,255,255,0.1)',
                  }}
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
                <Box>
                  <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'white', fontFamily: '"Outfit", sans-serif' }}>
                    {asset.symbol}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: '"Outfit", sans-serif' }}>
                    {asset.description}
                  </Typography>
                </Box>
              </Box>
              <Typography sx={{ fontSize: 18, fontWeight: 600, color: '#00d4aa', fontFamily: '"JetBrains Mono", monospace' }}>
                {formatPrice(asset.price)}
              </Typography>
            </Box>
          </Grid>
        ))}
      </Grid>

      {/* Your Assets Section */}
      <Typography sx={{ fontSize: 22, fontWeight: 600, color: '#00d4aa', mb: 2, fontFamily: '"Outfit", sans-serif' }}>
        Your Assets
      </Typography>

      <Box
        sx={{
          bgcolor: '#111820',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.06)',
          overflow: 'hidden',
        }}
      >
        {userAssets.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Box
              sx={{
                width: 70,
                height: 70,
                borderRadius: '50%',
                bgcolor: 'rgba(255,255,255,0.03)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto',
                mb: 2,
              }}
            >
              <AccountBalanceWallet sx={{ fontSize: 32, color: 'rgba(255,255,255,0.2)' }} />
            </Box>
            <Typography sx={{ fontSize: 18, fontWeight: 600, color: 'white', mb: 0.5, fontFamily: '"Outfit", sans-serif' }}>
              No Assets Yet
            </Typography>
            <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', mb: 3, fontFamily: '"Outfit", sans-serif' }}>
              Use demo transfer to simulate receiving assets
            </Typography>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => setOpenTransfer(true)}
              sx={{
                bgcolor: '#00d4aa',
                color: '#0a0e14',
                fontWeight: 600,
                px: 3,
                py: 1,
                borderRadius: '8px',
                textTransform: 'none',
                fontFamily: '"Outfit", sans-serif',
                '&:hover': { bgcolor: '#00c49a' },
              }}
            >
              Demo Transfer
            </Button>
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: 'rgba(255,255,255,0.5)', borderColor: 'rgba(255,255,255,0.06)', fontFamily: '"Outfit", sans-serif' }}>Asset</TableCell>
                  <TableCell sx={{ color: 'rgba(255,255,255,0.5)', borderColor: 'rgba(255,255,255,0.06)', fontFamily: '"Outfit", sans-serif' }}>Amount</TableCell>
                  <TableCell sx={{ color: 'rgba(255,255,255,0.5)', borderColor: 'rgba(255,255,255,0.06)', fontFamily: '"Outfit", sans-serif' }}>Value</TableCell>
                  <TableCell sx={{ color: 'rgba(255,255,255,0.5)', borderColor: 'rgba(255,255,255,0.06)', fontFamily: '"Outfit", sans-serif' }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {userAssets.map((asset) => (
                  <TableRow key={asset.contractId}>
                    <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Chip
                          label={asset.assetType}
                          size="small"
                          sx={{
                            bgcolor: 'rgba(0, 212, 170, 0.1)',
                            color: '#00d4aa',
                            fontFamily: '"Outfit", sans-serif',
                            fontWeight: 500,
                          }}
                        />
                        <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: '"JetBrains Mono", monospace' }}>
                          {asset.assetId.substring(0, 16)}...
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.06)', fontFamily: '"Outfit", sans-serif' }}>
                      {asset.amount.toLocaleString()}
                    </TableCell>
                    <TableCell sx={{ color: '#00d4aa', fontWeight: 600, borderColor: 'rgba(255,255,255,0.06)', fontFamily: '"JetBrains Mono", monospace' }}>
                      ${asset.valueUSD.toLocaleString()}
                    </TableCell>
                    <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          setSelectedUserAsset(asset);
                          setOpenDeposit(true);
                        }}
                        disabled={vaults.length === 0}
                        sx={{
                          borderColor: 'rgba(255,255,255,0.2)',
                          color: 'white',
                          fontFamily: '"Outfit", sans-serif',
                          textTransform: 'none',
                          '&:hover': { borderColor: '#00d4aa', color: '#00d4aa' }
                        }}
                      >
                        Deposit to Vault
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      {/* Demo Transfer Dialog */}
      <Dialog open={openTransfer} onClose={() => setOpenTransfer(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontFamily: '"Outfit", sans-serif' }}>Demo Transfer</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: 'rgba(255,255,255,0.5)', mb: 2, fontSize: 14, fontFamily: '"Outfit", sans-serif' }}>
            Simulate receiving assets for testing purposes
          </Typography>
          <FormControl fullWidth margin="dense" sx={{ mt: 1 }}>
            <InputLabel>Asset Type</InputLabel>
            <Select
              value={transferForm.assetType}
              label="Asset Type"
              onChange={(e) => setTransferForm({ ...transferForm, assetType: e.target.value })}
            >
              {assetPrices.map((asset) => (
                <MenuItem key={asset.symbol} value={asset.symbol}>
                  {asset.symbol} - {asset.description}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            margin="dense"
            label="Amount"
            type="number"
            fullWidth
            value={transferForm.amount}
            onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenTransfer(false)}>Cancel</Button>
          <Button
            onClick={handleDemoTransfer}
            variant="contained"
            disabled={!transferForm.amount || parseFloat(transferForm.amount) <= 0}
            sx={{ bgcolor: '#00d4aa', '&:hover': { bgcolor: '#00c49a' } }}
          >
            Transfer
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deposit to Vault Dialog */}
      <Dialog open={openDeposit} onClose={() => setOpenDeposit(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontFamily: '"Outfit", sans-serif' }}>
          Deposit Asset to Vault
        </DialogTitle>
        <DialogContent>
          {selectedUserAsset && (
            <Box sx={{ mb: 2, p: 2, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1 }}>
              <Typography variant="body2" color="textSecondary">Selected Asset:</Typography>
              <Typography variant="body1">
                {selectedUserAsset.assetType} - {selectedUserAsset.amount.toLocaleString()} (${selectedUserAsset.valueUSD.toLocaleString()})
              </Typography>
            </Box>
          )}

          <FormControl fullWidth margin="dense" sx={{ mt: 2 }}>
            <InputLabel>Select Vault</InputLabel>
            <Select
              value={depositVaultId}
              label="Select Vault"
              onChange={(e) => setDepositVaultId(e.target.value)}
            >
              {vaults.map((vault) => (
                <MenuItem key={vault.vaultId} value={vault.vaultId}>
                  {vault.vaultId} (${vault.totalValue.toLocaleString()})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeposit(false)}>Cancel</Button>
          <Button
            onClick={handleDepositToVault}
            variant="contained"
            disabled={!depositVaultId}
            sx={{ bgcolor: '#00d4aa', '&:hover': { bgcolor: '#00c49a' } }}
          >
            Deposit
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
