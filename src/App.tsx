import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Box, Typography, List, ListItem, ListItemIcon, ListItemText, ListItemButton, Button, TextField, Select, MenuItem, FormControl, InputLabel, Chip } from '@mui/material';
import {
  Dashboard as DashboardIcon,
  AccountBalance,
  VerifiedUser,
  Settings,
  Description,
  PersonAdd,
  Delete,
  AdminPanelSettings,
  TrendingUp,
  Handshake,
  People,
  Add,
  Close
} from '@mui/icons-material';
import { getSDK, type AuthUser, type Asset } from '@stratos-wallet/sdk';
import { RoleProvider, useRole } from './context/RoleContext';
import { assetAPI } from './services/api';
import { setNetworkMode, type NetworkMode } from './services/evmEscrow';
import Dashboard from './pages/Dashboard';
import VaultManagement from './pages/VaultManagement';
import MarginVerification from './pages/MarginVerification';
import Positions from './pages/Positions';
import FundBrokerLinks from './pages/FundBrokerLinks';
import BrokerFundLinks from './pages/BrokerFundLinks';

// All menu items with role visibility
const allMenuItems = [
  { path: '/', label: 'Dashboard', icon: DashboardIcon, roles: ['fund', 'primebroker', 'operator'] as string[] },
  { path: '/vaults', label: 'Vaults', icon: AccountBalance, roles: ['fund'] as string[] },
  { path: '/positions', label: 'Positions', icon: TrendingUp, roles: ['fund', 'primebroker'] as string[] },
  { path: '/brokers', label: 'My Brokers', icon: Handshake, roles: ['fund'] as string[] },
  { path: '/funds', label: 'Client Accounts', icon: People, roles: ['primebroker'] as string[] },
  { path: '/margin', label: 'Margin Verification', icon: VerifiedUser, roles: ['fund', 'primebroker'] as string[] },
];

const bottomMenuItems = [
  { path: '/settings', label: 'Settings', icon: Settings },
  { path: '/docs', label: 'Documentation', icon: Description },
];


function Sidebar() {
  const location = useLocation();
  const { role, isOperator } = useRole();

  const effectiveRole = isOperator ? 'operator' : role;
  const menuItems = allMenuItems.filter(item => !effectiveRole || item.roles.includes(effectiveRole));

  // Only operator gets the admin link (brokers manage funds via Client Accounts)
  const showAdmin = isOperator;

  return (
    <Box
      component="nav"
      sx={{
        width: 240,
        minWidth: 240,
        height: '100vh',
        bgcolor: '#0d1117',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        left: 0,
        top: 0,
        zIndex: 1000,
      }}
    >
      {/* Logo */}
      <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '8px',
            border: '2px solid #00d4aa',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#00d4aa' }} />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 600, fontSize: 16, color: 'white', letterSpacing: '-0.3px', fontFamily: '"Outfit", sans-serif' }}>
            Priva<span style={{ color: '#00d4aa' }}>Margin</span>
          </Typography>
          <Typography sx={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: '"Outfit", sans-serif' }}>
            Private Collateral Vault
          </Typography>
        </Box>
      </Box>

      {/* Main Navigation */}
      <List sx={{ flex: 1, pt: 2 }}>
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <ListItem key={item.path} disablePadding sx={{ px: 1.5, mb: 0.5 }}>
              <ListItemButton
                component={Link}
                to={item.path}
                sx={{
                  borderRadius: '8px',
                  bgcolor: isActive ? 'rgba(0, 212, 170, 0.1)' : 'transparent',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
                  py: 1.2,
                }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <item.icon sx={{ color: isActive ? '#00d4aa' : 'rgba(255,255,255,0.5)', fontSize: 20 }} />
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{
                    sx: {
                      fontSize: 14,
                      fontWeight: isActive ? 500 : 400,
                      color: isActive ? '#00d4aa' : 'rgba(255,255,255,0.7)',
                      fontFamily: '"Outfit", sans-serif',
                    },
                  }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>

      {/* Admin link for operator / broker */}
      {showAdmin && (
        <List sx={{ px: 1.5 }}>
          <ListItem disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              component={Link}
              to="/admin"
              sx={{
                borderRadius: '8px',
                bgcolor: location.pathname === '/admin' ? 'rgba(245, 158, 11, 0.1)' : 'transparent',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
                py: 1.2,
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <AdminPanelSettings sx={{ color: location.pathname === '/admin' ? '#f59e0b' : 'rgba(255,255,255,0.5)', fontSize: 20 }} />
              </ListItemIcon>
              <ListItemText
                primary="Manage Roles"
                primaryTypographyProps={{
                  sx: {
                    fontSize: 14,
                    fontWeight: location.pathname === '/admin' ? 500 : 400,
                    color: location.pathname === '/admin' ? '#f59e0b' : 'rgba(255,255,255,0.7)',
                    fontFamily: '"Outfit", sans-serif',
                  },
                }}
              />
            </ListItemButton>
          </ListItem>
        </List>
      )}

      {/* Bottom Navigation */}
      <List sx={{ pb: 2 }}>
        {bottomMenuItems.map((item) => (
          <ListItem key={item.path} disablePadding sx={{ px: 1.5, mb: 0.5 }}>
            <ListItemButton
              component={Link}
              to={item.path}
              sx={{
                borderRadius: '8px',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
                py: 1,
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <item.icon sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 18 }} />
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{
                  sx: {
                    fontSize: 13,
                    color: 'rgba(255,255,255,0.5)',
                    fontFamily: '"Outfit", sans-serif',
                  },
                }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );
}

function RoleBadge() {
  const { role, isOperator } = useRole();
  if (!role && !isOperator) return null;

  const label = role === 'primebroker' ? 'Primebroker' : role === 'fund' ? 'Fund' : 'Operator';
  const color = role === 'primebroker' ? '#8b5cf6' : role === 'fund' ? '#00d4aa' : '#f59e0b';

  return (
    <Box
      sx={{
        px: 1.5,
        py: 0.4,
        bgcolor: `${color}20`,
        borderRadius: '12px',
        border: `1px solid ${color}50`,
      }}
    >
      <Typography sx={{ fontSize: 11, color, fontWeight: 600, fontFamily: '"Outfit", sans-serif', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </Typography>
    </Box>
  );
}

function Header({ user }: { user: AuthUser | null }) {
  return (
    <Box
      component="header"
      sx={{
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: 2,
        p: 2,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <RoleBadge />
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 0.8,
          bgcolor: 'rgba(0, 212, 170, 0.1)',
          borderRadius: '20px',
          border: '1px solid rgba(0, 212, 170, 0.3)',
        }}
      >
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#00d4aa' }} />
        <Typography sx={{ fontSize: 13, color: '#00d4aa', fontWeight: 500, fontFamily: '"Outfit", sans-serif' }}>Connected</Typography>
      </Box>
      <Box
        sx={{
          px: 2,
          py: 0.8,
          bgcolor: 'rgba(255,255,255,0.05)',
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <Typography sx={{ fontSize: 13, color: 'white', fontWeight: 500, fontFamily: '"Outfit", sans-serif' }}>
          {user?.partyId?.split('::')[0] || 'InstitutionA'}
        </Typography>
      </Box>
    </Box>
  );
}

// Top Navigation Header for non-dashboard pages
function SidebarLayout({ children, user }: { children: React.ReactNode; user: AuthUser | null }) {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#0a0e14' }}>
      <Sidebar />
      <Box
        component="main"
        sx={{
          flex: 1,
          marginLeft: '240px',
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
        }}
      >
        <Header user={user} />
        <Box sx={{ flex: 1, p: 3 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}

// Operator Setup UI — assign roles to parties
function OperatorSetup({ user }: { user: AuthUser }) {
  const { assignRole, removeRole, allRoles, refreshRoles, role: ownRole } = useRole();
  const [newPartyId, setNewPartyId] = useState('');
  const [newRole, setNewRole] = useState<'fund' | 'primebroker' | 'operator'>('primebroker');

  // Platform asset management (operator only)
  const [platformAssets, setPlatformAssets] = useState<Array<{ type: string; name: string; category: string }>>([]);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [newAssetType, setNewAssetType] = useState('');
  const [newAssetName, setNewAssetName] = useState('');
  const [newAssetCategory, setNewAssetCategory] = useState('Crypto');
  const [savingAssets, setSavingAssets] = useState(false);

  useEffect(() => {
    if (!ownRole) {
      assetAPI.getTypes().then(res => {
        setPlatformAssets(res.data);
        setAssetsLoaded(true);
      });
    }
  }, [ownRole]);

  const handleAddAsset = () => {
    if (!newAssetType.trim() || !newAssetName.trim()) return;
    const exists = platformAssets.some(a => a.type === newAssetType.trim().toUpperCase());
    if (exists) return;
    setPlatformAssets([...platformAssets, {
      type: newAssetType.trim().toUpperCase(),
      name: newAssetName.trim(),
      category: newAssetCategory,
    }]);
    setNewAssetType('');
    setNewAssetName('');
  };

  const handleRemoveAsset = (type: string) => {
    setPlatformAssets(platformAssets.filter(a => a.type !== type));
  };

  const handleSaveAssets = async () => {
    setSavingAssets(true);
    try {
      await assetAPI.saveTypes(platformAssets);
    } catch (err) {
      console.warn('Failed to save platform assets:', err);
    }
    setSavingAssets(false);
  };

  const handleAssign = async () => {
    if (!newPartyId.trim()) return;
    await assignRole(newPartyId.trim(), newRole);
    setNewPartyId('');
    await refreshRoles();
  };

  // Determine what roles this user can assign
  const canAssignBroker = !ownRole; // operator (no role) can assign brokers
  const availableRoles: Array<{ value: 'fund' | 'primebroker' | 'operator'; label: string }> = [];
  if (canAssignBroker) {
    availableRoles.push({ value: 'operator', label: 'Operator' });
    availableRoles.push({ value: 'primebroker', label: 'Primebroker' });
  }
  availableRoles.push({ value: 'fund', label: 'Fund' });

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', bgcolor: '#0a0e14' }}>
      <Box sx={{ maxWidth: 600, width: '100%', p: 4 }}>
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: '12px',
              border: '2px solid #00d4aa',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto',
              mb: 2,
            }}
          >
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#00d4aa' }} />
          </Box>
          <Typography sx={{ fontSize: 24, fontWeight: 600, color: 'white', mb: 1, fontFamily: '"Outfit", sans-serif' }}>
            {ownRole === 'primebroker' ? 'Manage Fund Accounts' : 'Role Assignment'}
          </Typography>
          <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', fontFamily: '"Outfit", sans-serif' }}>
            {ownRole === 'primebroker'
              ? 'Add fund accounts by entering their party ID'
              : 'Assign roles to parties to configure the system. Operator assigns primebrokers, primebrokers assign funds.'}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', mt: 1, fontFamily: '"Outfit", sans-serif' }}>
            Connected as: {user.partyId?.split('::')[0] || user.id}
          </Typography>
        </Box>

        {/* Assign role form */}
        <Box
          sx={{
            bgcolor: '#111820',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.06)',
            p: 3,
            mb: 3,
          }}
        >
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'white', mb: 2, fontFamily: '"Outfit", sans-serif' }}>
            Add Party
          </Typography>
          <TextField
            fullWidth
            placeholder="Enter party ID"
            value={newPartyId}
            onChange={(e) => setNewPartyId(e.target.value)}
            sx={{
              mb: 2,
              '& .MuiOutlinedInput-root': {
                color: 'white',
                '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
                '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
              },
              '& .MuiInputBase-input::placeholder': { color: 'rgba(255,255,255,0.3)' },
            }}
          />
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel sx={{ color: 'rgba(255,255,255,0.5)' }}>Role</InputLabel>
            <Select
              value={newRole}
              label="Role"
              onChange={(e) => setNewRole(e.target.value as 'fund' | 'primebroker' | 'operator')}
              sx={{
                color: 'white',
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' },
                '& .MuiSvgIcon-root': { color: 'rgba(255,255,255,0.5)' },
              }}
            >
              {availableRoles.map((r) => (
                <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            fullWidth
            variant="contained"
            startIcon={<PersonAdd />}
            onClick={handleAssign}
            disabled={!newPartyId.trim()}
            sx={{
              bgcolor: '#00d4aa',
              color: '#0a0e14',
              fontWeight: 600,
              textTransform: 'none',
              '&:hover': { bgcolor: '#00c49a' },
              '&.Mui-disabled': { bgcolor: 'rgba(0,212,170,0.3)', color: 'rgba(10,14,20,0.5)' },
            }}
          >
            Assign Role
          </Button>
        </Box>

        {/* Current roles */}
        <Box
          sx={{
            bgcolor: '#111820',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.06)',
            p: 3,
          }}
        >
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'white', mb: 2, fontFamily: '"Outfit", sans-serif' }}>
            Assigned Roles
          </Typography>
          {Object.keys(allRoles).length === 0 ? (
            <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center', py: 2 }}>
              No roles assigned yet
            </Typography>
          ) : (
            Object.entries(allRoles).map(([pid, r]) => (
              <Box
                key={pid}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  p: 1.5,
                  mb: 1,
                  bgcolor: 'rgba(255,255,255,0.02)',
                  borderRadius: '8px',
                  '&:last-child': { mb: 0 },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography sx={{ fontSize: 13, color: 'white', fontFamily: 'monospace' }}>
                    {pid.split('::')[0]}
                  </Typography>
                  <Chip
                    label={r === 'operator' ? 'Operator' : r === 'primebroker' ? 'Primebroker' : 'Fund'}
                    size="small"
                    sx={{
                      bgcolor: r === 'operator' ? 'rgba(245,158,11,0.2)' : r === 'primebroker' ? 'rgba(139,92,246,0.2)' : 'rgba(0,212,170,0.2)',
                      color: r === 'operator' ? '#f59e0b' : r === 'primebroker' ? '#8b5cf6' : '#00d4aa',
                      fontWeight: 600,
                      fontSize: 11,
                    }}
                  />
                </Box>
                <Button
                  size="small"
                  onClick={() => removeRole(pid)}
                  sx={{ color: 'rgba(255,255,255,0.3)', minWidth: 'auto', '&:hover': { color: '#ef4444' } }}
                >
                  <Delete sx={{ fontSize: 18 }} />
                </Button>
              </Box>
            ))
          )}
        </Box>

        {/* Platform Assets Configuration (operator only) */}
        {!ownRole && assetsLoaded && (
          <Box
            sx={{
              bgcolor: '#111820',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.06)',
              p: 3,
              mt: 3,
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'white', fontFamily: '"Outfit", sans-serif' }}>
                Platform Assets
              </Typography>
              <Button
                size="small"
                variant="contained"
                onClick={handleSaveAssets}
                disabled={savingAssets}
                sx={{
                  bgcolor: '#00d4aa',
                  color: '#0a0e14',
                  fontWeight: 600,
                  textTransform: 'none',
                  fontSize: 12,
                  '&:hover': { bgcolor: '#00c49a' },
                  '&.Mui-disabled': { bgcolor: 'rgba(0,212,170,0.3)' },
                }}
              >
                {savingAssets ? 'Saving...' : 'Save Changes'}
              </Button>
            </Box>
            <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', mb: 2, fontFamily: '"Outfit", sans-serif' }}>
              Assets available for brokers to configure as tradeable or collateral. Initialized with wallet SDK supported tokens.
            </Typography>

            {/* Current assets */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8, mb: 2 }}>
              {platformAssets.map(a => (
                <Chip
                  key={a.type}
                  label={`${a.type} — ${a.name}`}
                  size="small"
                  onDelete={() => handleRemoveAsset(a.type)}
                  deleteIcon={<Close sx={{ fontSize: 14 }} />}
                  sx={{
                    bgcolor: a.category === 'Stablecoin' ? 'rgba(59,130,246,0.15)' : 'rgba(0,212,170,0.15)',
                    color: a.category === 'Stablecoin' ? '#60a5fa' : '#00d4aa',
                    fontWeight: 500,
                    fontSize: 12,
                    '& .MuiChip-deleteIcon': {
                      color: 'rgba(255,255,255,0.3)',
                      '&:hover': { color: '#ef4444' },
                    },
                  }}
                />
              ))}
            </Box>

            {/* Add new asset */}
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
              <TextField
                size="small"
                placeholder="Symbol (e.g. DOGE)"
                value={newAssetType}
                onChange={e => setNewAssetType(e.target.value)}
                sx={{
                  flex: 1,
                  '& .MuiOutlinedInput-root': {
                    color: 'white',
                    fontSize: 13,
                    '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
                    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                  },
                  '& .MuiInputBase-input::placeholder': { color: 'rgba(255,255,255,0.3)' },
                }}
              />
              <TextField
                size="small"
                placeholder="Name (e.g. Dogecoin)"
                value={newAssetName}
                onChange={e => setNewAssetName(e.target.value)}
                sx={{
                  flex: 1,
                  '& .MuiOutlinedInput-root': {
                    color: 'white',
                    fontSize: 13,
                    '& fieldset': { borderColor: 'rgba(255,255,255,0.1)' },
                    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                  },
                  '& .MuiInputBase-input::placeholder': { color: 'rgba(255,255,255,0.3)' },
                }}
              />
              <FormControl size="small" sx={{ minWidth: 110 }}>
                <Select
                  value={newAssetCategory}
                  onChange={e => setNewAssetCategory(e.target.value)}
                  sx={{
                    color: 'white',
                    fontSize: 13,
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.1)' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' },
                    '& .MuiSvgIcon-root': { color: 'rgba(255,255,255,0.5)' },
                  }}
                >
                  <MenuItem value="Crypto">Crypto</MenuItem>
                  <MenuItem value="Stablecoin">Stablecoin</MenuItem>
                  <MenuItem value="RWA">RWA</MenuItem>
                  <MenuItem value="Bond">Bond</MenuItem>
                  <MenuItem value="Equity">Equity</MenuItem>
                </Select>
              </FormControl>
              <Button
                size="small"
                variant="contained"
                onClick={handleAddAsset}
                disabled={!newAssetType.trim() || !newAssetName.trim()}
                sx={{
                  bgcolor: '#00d4aa',
                  color: '#0a0e14',
                  minWidth: 36,
                  px: 1,
                  '&:hover': { bgcolor: '#00c49a' },
                  '&.Mui-disabled': { bgcolor: 'rgba(0,212,170,0.3)' },
                }}
              >
                <Add sx={{ fontSize: 18 }} />
              </Button>
            </Box>
          </Box>
        )}

        {/* Self-assign shortcut for operator */}
        {!ownRole && (
          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', mb: 1.5, fontFamily: '"Outfit", sans-serif' }}>
              Or assign yourself a role to start using the app:
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
              <Button
                variant="outlined"
                onClick={() => assignRole(user.partyId || user.id, 'fund')}
                sx={{
                  borderColor: '#00d4aa',
                  color: '#00d4aa',
                  textTransform: 'none',
                  fontWeight: 600,
                  '&:hover': { borderColor: '#00d4aa', bgcolor: 'rgba(0,212,170,0.1)' },
                }}
              >
                Use as Fund
              </Button>
              <Button
                variant="outlined"
                onClick={() => assignRole(user.partyId || user.id, 'primebroker')}
                sx={{
                  borderColor: '#8b5cf6',
                  color: '#8b5cf6',
                  textTransform: 'none',
                  fontWeight: 600,
                  '&:hover': { borderColor: '#8b5cf6', bgcolor: 'rgba(139,92,246,0.1)' },
                }}
              >
                Use as Primebroker
              </Button>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// First-ever user bootstrap: become the operator
function BecomeOperator({ user }: { user: AuthUser }) {
  const { becomeOperator } = useRole();
  const [claiming, setClaiming] = useState(false);

  const handleClaim = async () => {
    setClaiming(true);
    await becomeOperator();
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', bgcolor: '#0a0e14' }}>
      <Box sx={{ textAlign: 'center', maxWidth: 460 }}>
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: '14px',
            border: '2px solid #f59e0b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto',
            mb: 3,
          }}
        >
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: '#f59e0b' }} />
        </Box>
        <Typography sx={{ fontSize: 24, fontWeight: 600, color: 'white', mb: 1, fontFamily: '"Outfit", sans-serif' }}>
          Welcome to PrivaMargin
        </Typography>
        <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', mb: 1, fontFamily: '"Outfit", sans-serif' }}>
          No operator has been configured yet. The operator is the system administrator who assigns primebrokers, who in turn onboard fund accounts.
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', mb: 3, fontFamily: 'monospace' }}>
          Party: {user.partyId?.split('::')[0] || user.id}
        </Typography>
        <Button
          variant="contained"
          onClick={handleClaim}
          disabled={claiming}
          sx={{
            bgcolor: '#f59e0b',
            color: '#0a0e14',
            fontWeight: 700,
            px: 5,
            py: 1.5,
            borderRadius: '10px',
            textTransform: 'none',
            fontSize: 15,
            '&:hover': { bgcolor: '#d97706' },
            '&.Mui-disabled': { bgcolor: 'rgba(245,158,11,0.4)', color: 'rgba(10,14,20,0.5)' },
          }}
        >
          {claiming ? 'Setting up...' : 'Become Operator'}
        </Button>
      </Box>
    </Box>
  );
}

// Awaiting role assignment screen for non-operator users
function AwaitingRole({ user }: { user: AuthUser }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', bgcolor: '#0a0e14' }}>
      <Box sx={{ textAlign: 'center', maxWidth: 400 }}>
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: '12px',
            border: '2px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto',
            mb: 2,
          }}
        >
          <Box className="loading-spinner" sx={{ width: 20, height: 20 }} />
        </Box>
        <Typography sx={{ fontSize: 20, fontWeight: 600, color: 'white', mb: 1, fontFamily: '"Outfit", sans-serif' }}>
          Awaiting Role Assignment
        </Typography>
        <Typography sx={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', mb: 2, fontFamily: '"Outfit", sans-serif' }}>
          Your account has been connected but no role has been assigned yet.
          Please contact the operator or your primebroker.
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
          Party: {user.partyId?.split('::')[0] || user.id}
        </Typography>
      </Box>
    </Box>
  );
}

function AppRoutes({ user, assets }: { user: AuthUser; assets: Asset[] }) {
  const { role, isPrimeBroker, isOperator } = useRole();

  return (
    <SidebarLayout user={user}>
      <Routes>
        <Route path="/" element={<Dashboard user={user} assets={assets} />} />

        {/* Fund-only pages */}
        {(!role || role === 'fund') && (
          <>
            <Route path="/vaults" element={<VaultManagement user={user} assets={assets} />} />
            <Route path="/brokers" element={<FundBrokerLinks user={user} />} />
          </>
        )}

        {/* Broker-only pages */}
        {isPrimeBroker && (
          <Route path="/funds" element={<BrokerFundLinks user={user} />} />
        )}

        {/* Shared pages */}
        <Route path="/positions" element={<Positions user={user} assets={assets} />} />
        <Route path="/margin" element={<MarginVerification user={user} />} />
        {/* Admin: role management (operator only) */}
        {isOperator && (
          <Route path="/admin" element={<OperatorSetup user={user} />} />
        )}

        <Route path="/settings" element={
          <Box><Typography sx={{ color: 'white', fontFamily: '"Outfit", sans-serif' }}>Settings (Coming Soon)</Typography></Box>
        } />
        <Route path="/docs" element={
          <Box><Typography sx={{ color: 'white', fontFamily: '"Outfit", sans-serif' }}>Documentation (Coming Soon)</Typography></Box>
        } />
      </Routes>
    </SidebarLayout>
  );
}

function RoleGate({ user, assets }: { user: AuthUser; assets: Asset[] }) {
  const { role, isOperator, isPrimeBroker, hasOperator, loading } = useRole();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', bgcolor: '#0a0e14' }}>
        <Box sx={{ textAlign: 'center' }}>
          <Box className="loading-spinner" sx={{ margin: '0 auto', mb: 2 }} />
          <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontFamily: '"Outfit", sans-serif' }}>Loading role...</Typography>
        </Box>
      </Box>
    );
  }

  // No operator exists yet — first user becomes operator
  if (!hasOperator) {
    return <BecomeOperator user={user} />;
  }

  // Operator gets the full app (Dashboard with Relay/Custodian panels + admin route)
  if (isOperator) {
    return <AppRoutes user={user} assets={assets} />;
  }

  // No role assigned yet
  if (!role) {
    // Primebroker can manage roles
    if (isPrimeBroker) {
      return <OperatorSetup user={user} />;
    }
    // Non-operator, non-broker without a role: awaiting assignment
    return <AwaitingRole user={user} />;
  }

  // Role assigned — show the main app
  return <AppRoutes user={user} assets={assets} />;
}

function AppContent() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);

  const sdk = getSDK({ debug: true });

  useEffect(() => {
    if (window.parent === window) {
      setError('This app must be embedded in the Stratos portal');
      setLoading(false);
      return;
    }

    const init = async () => {
      try {
        const state = await sdk.connect();
        setConnected(state.connected);
        setUser(state.user);

        // Detect network mode from wallet SDK (cast through unknown — field added in SDK update)
        const network = (state as unknown as { network?: NetworkMode }).network;
        if (network) {
          setNetworkMode(network);
        }

        if (state.connected) {
          const assetsData = await sdk.getAssets();
          setAssets(assetsData);
        }
      } catch (err) {
        console.error('Failed to connect:', err);
        setError(err instanceof Error ? err.message : 'Failed to connect');
      } finally {
        setLoading(false);
      }
    };

    init();

    // Listen for network changes from wallet
    const handleWalletMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'wallet_event' && msg.event === 'networkChanged') {
        const net = msg.data as NetworkMode;
        if (net === 'mainnet' || net === 'testnet') {
          setNetworkMode(net);
        }
      }
    };
    window.addEventListener('message', handleWalletMessage);

    sdk.on('assetsChanged', setAssets);
    sdk.on('userChanged', (newUser) => {
      setUser(newUser);
      setConnected(newUser !== null);
      if (newUser) {
        sdk.getAssets().then(setAssets).catch(() => {});
      } else {
        setAssets([]);
      }
    });

    return () => {
      sdk.removeAllListeners();
      window.removeEventListener('message', handleWalletMessage);
    };
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', bgcolor: '#0a0e14' }}>
        <Box sx={{ textAlign: 'center' }}>
          <Box className="loading-spinner" sx={{ margin: '0 auto', mb: 2 }} />
          <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontFamily: '"Outfit", sans-serif' }}>Connecting to PrivaMargin...</Typography>
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', bgcolor: '#0a0e14' }}>
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h5" sx={{ color: '#ef4444', mb: 1, fontFamily: '"Outfit", sans-serif' }}>Connection Error</Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontFamily: '"Outfit", sans-serif' }}>{error}</Typography>
        </Box>
      </Box>
    );
  }

  if (!connected || !user) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', bgcolor: '#0a0e14' }}>
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h5" sx={{ color: 'white', mb: 1, fontFamily: '"Outfit", sans-serif' }}>Not Connected</Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontFamily: '"Outfit", sans-serif' }}>Please log in to the portal to access PrivaMargin.</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <RoleProvider user={user}>
      <RoleGate user={user} assets={assets} />
    </RoleProvider>
  );
}

function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

export default App;
