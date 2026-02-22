import { useState, useEffect, useMemo, useCallback } from 'react';
import { getSDK } from '@stratos-wallet/sdk';
import {
  PrivaMarginService,
  Vault,
  Asset,
  MarginCall,
  MarginRequirement,
  MarginVerifyResult
} from './service';

export interface UsePrivaMarginOptions {
  packageId: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export interface UsePrivaMarginState {
  connected: boolean;
  partyId: string | null;
  vaults: Vault[];
  assets: Asset[];
  marginCalls: MarginCall[];
  marginRequirements: MarginRequirement[];
  prices: Record<string, number>;
  loading: boolean;
  dataLoaded: boolean;
  error: string | null;
  service: PrivaMarginService;
  refresh: () => Promise<void>;
  // Actions
  createVault: (vaultId: string) => Promise<string>;
  depositToVault: (vaultContractId: string, assetContractId: string) => Promise<void>;
  mintAsset: (assetId: string, assetType: string, amount: number, valueUSD: number) => Promise<string>;
  verifyMargin: (marginRequirementId: string, vaultContractId: string) => Promise<MarginVerifyResult>;
  triggerMarginCall: (marginRequirementId: string) => Promise<string>;
  settleMarginCall: (marginCallId: string, vaultContractId: string) => Promise<void>;
  cancelMarginCall: (marginCallId: string) => Promise<void>;
}

export function usePrivaMargin(options: UsePrivaMarginOptions): UsePrivaMarginState {
  const [connected, setConnected] = useState(false);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [marginCalls, setMarginCalls] = useState<MarginCall[]>([]);
  const [marginRequirements, setMarginRequirements] = useState<MarginRequirement[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sdk = useMemo(() => getSDK({ debug: true }), []);
  const service = useMemo(
    () => new PrivaMarginService(options.packageId, sdk),
    [options.packageId, sdk]
  );

  const loadData = useCallback(async () => {
    if (!options.packageId) return;

    try {
      const [vaultsData, assetsData, marginCallsData, marginReqsData, pricesData] = await Promise.all([
        service.getVaults(),
        service.getAssets(),
        service.getActiveMarginCalls(),
        service.getMarginRequirements(),
        fetch('/api/prices')
          .then(r => r.json() as Promise<{ prices: Record<string, number> }>)
          .catch(() => ({ prices: {} as Record<string, number> }))
      ]);

      setVaults(vaultsData);
      setAssets(assetsData);
      setMarginCalls(marginCallsData);
      setMarginRequirements(marginReqsData);
      setPrices(pricesData.prices || {});
      setError(null);
      setDataLoaded(true);
    } catch (err) {
      console.error('Failed to load data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    }
  }, [service, options.packageId]);

  useEffect(() => {
    // Check if running in iframe (required for SDK)
    if (window.parent === window) {
      console.warn('[PrivaMargin] Not running in iframe - SDK features may be limited');
    }

    const init = async () => {
      try {
        const state = await sdk.connect();
        setConnected(state.connected);

        if (state.user?.partyId) {
          setPartyId(state.user.partyId);
          await loadData();
        }
      } catch (err) {
        console.error('Failed to connect:', err);
        setError(err instanceof Error ? err.message : 'Failed to connect');
      } finally {
        setLoading(false);
      }
    };

    init();

    // Listen for user changes
    sdk.on('userChanged', async (newUser) => {
      setPartyId(newUser?.partyId || null);
      setConnected(newUser !== null);
      if (newUser?.partyId) {
        setLoading(true);
        await loadData();
        setLoading(false);
      }
    });

    return () => {
      sdk.removeAllListeners();
    };
  }, [sdk, loadData]);

  // Auto-refresh
  useEffect(() => {
    if (!options.autoRefresh || !connected || !partyId) return;

    const interval = setInterval(loadData, options.refreshInterval || 30000);
    return () => clearInterval(interval);
  }, [options.autoRefresh, options.refreshInterval, loadData, partyId, connected]);

  // Action handlers
  const createVault = useCallback(async (vaultId: string) => {
    const contractId = await service.createVault(vaultId);
    await loadData();
    return contractId;
  }, [service, loadData]);

  const depositToVault = useCallback(async (vaultContractId: string, assetContractId: string) => {
    await service.depositToVault(vaultContractId, assetContractId);
    await loadData();
  }, [service, loadData]);

  const mintAsset = useCallback(async (assetId: string, assetType: string, amount: number, valueUSD: number) => {
    const contractId = await service.mintAsset(assetId, assetType, amount, valueUSD);
    await loadData();
    return contractId;
  }, [service, loadData]);

  const verifyMargin = useCallback(async (marginRequirementId: string, vaultContractId: string) => {
    const result = await service.verifyMargin(marginRequirementId, vaultContractId);
    await loadData();
    return result;
  }, [service, loadData]);

  const triggerMarginCall = useCallback(async (marginRequirementId: string) => {
    const contractId = await service.triggerMarginCall(marginRequirementId);
    await loadData();
    return contractId;
  }, [service, loadData]);

  const settleMarginCall = useCallback(async (marginCallId: string, vaultContractId: string) => {
    await service.settleMarginCall(marginCallId, vaultContractId, []);
    await loadData();
  }, [service, loadData]);

  const cancelMarginCall = useCallback(async (marginCallId: string) => {
    await service.cancelMarginCall(marginCallId);
    await loadData();
  }, [service, loadData]);

  return {
    connected,
    partyId,
    vaults,
    assets,
    marginCalls,
    marginRequirements,
    prices,
    loading,
    dataLoaded,
    error,
    service,
    refresh: loadData,
    createVault,
    depositToVault,
    mintAsset,
    verifyMargin,
    triggerMarginCall,
    settleMarginCall,
    cancelMarginCall
  };
}
