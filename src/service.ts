import { getSDK, type StratosSDK } from '@stratos-wallet/sdk';

// Types for DAML contract payloads
export interface AssetPosition {
  assetId: string;
  assetType: string;
  amount: string;
  valueUSD: string;
}

export interface VaultPayload {
  owner: string;
  operator: string;
  vaultId: string;
  collateralAssets: AssetPosition[];
  linkedPositions: string[];
}

export interface TokenizedAssetPayload {
  issuer: string;
  owner: string;
  assetId: string;
  assetType: string;
  amount: string;
  valueUSD: string;
}

export interface MarginRequirementPayload {
  provider: string;
  counterparty: string;
  operator: string;
  positionId: string;
  requiredMargin: string;
  vaultId: string;
  verificationStatus: { tag: string };
  lastChecked: string | null;
}

export interface MarginCallPayload {
  provider: string;
  counterparty: string;
  operator: string;
  positionId: string;
  requiredAmount: string;
  callTime: string | null;
  status: { tag: string };
}

// Display types (transformed from payloads)
export interface Vault {
  contractId: string;
  vaultId: string;
  owner: string;
  operator: string;
  collateralAssets: {
    assetId: string;
    assetType: string;
    amount: number;
    valueUSD: number;
  }[];
  linkedPositions: string[];
  totalValue: number;
}

export interface Asset {
  contractId: string;
  assetId: string;
  assetType: string;
  owner: string;
  issuer: string;
  amount: number;
  valueUSD: number;
}

export interface MarginRequirement {
  contractId: string;
  positionId: string;
  provider: string;
  counterparty: string;
  vaultId: string;
  requiredMargin: number;
  status: string;
  lastChecked: string | null;
}

export interface MarginCall {
  contractId: string;
  positionId: string;
  provider: string;
  counterparty: string;
  requiredAmount: number;
  status: string;
  createdAt: string | null;
}

export interface MarginVerifyResult {
  status: string;
  proof: string;
  timestamp: string;
}

export class PrivaMarginService {
  private sdk: StratosSDK;
  private packageId: string;

  constructor(packageId: string, sdk?: StratosSDK) {
    this.sdk = sdk || getSDK({ debug: true });
    this.packageId = packageId;
  }

  private templateId(module: string, template: string): string {
    return `${this.packageId}:${module}:${template}`;
  }

  // Vault operations
  async createVault(vaultId: string): Promise<string> {
    const partyId = await this.sdk.getPartyId();
    const result = await this.sdk.cantonCreate({
      templateId: this.templateId('CollateralVault', 'CollateralVault'),
      payload: {
        owner: partyId,
        operator: partyId, // Self-operated for demo
        vaultId,
        collateralAssets: [],
        linkedPositions: []
      }
    });
    return result.contractId;
  }

  async getVaults(): Promise<Vault[]> {
    const contracts = await this.sdk.cantonQuery<VaultPayload>({
      templateId: this.templateId('CollateralVault', 'CollateralVault'),
    });
    return contracts.map(c => this.mapVault(c));
  }

  async getVaultByContractId(contractId: string): Promise<Vault | null> {
    const contracts = await this.sdk.cantonQuery<VaultPayload>({
      templateId: this.templateId('CollateralVault', 'CollateralVault'),
    });
    const contract = contracts.find(c => c.contractId === contractId);
    return contract ? this.mapVault(contract) : null;
  }

  async depositToVault(vaultContractId: string, assetContractId: string): Promise<void> {
    await this.sdk.cantonExercise({
      contractId: vaultContractId,
      templateId: this.templateId('CollateralVault', 'CollateralVault'),
      choice: 'DepositAsset',
      argument: { assetCid: assetContractId }
    });
  }

  async withdrawFromVault(vaultContractId: string, assetId: string, issuer: string): Promise<void> {
    await this.sdk.cantonExercise({
      contractId: vaultContractId,
      templateId: this.templateId('CollateralVault', 'CollateralVault'),
      choice: 'WithdrawAsset',
      argument: { assetId, issuer }
    });
  }

  // Asset operations
  async getAssets(): Promise<Asset[]> {
    const contracts = await this.sdk.cantonQuery<TokenizedAssetPayload>({
      templateId: this.templateId('Assets', 'TokenizedAsset'),
    });
    return contracts.map(c => this.mapAsset(c));
  }

  async mintAsset(assetId: string, assetType: string, amount: number, valueUSD: number): Promise<string> {
    const partyId = await this.sdk.getPartyId();
    // Create asset issuance
    const result = await this.sdk.cantonCreate({
      templateId: this.templateId('Assets', 'AssetIssuance'),
      payload: {
        issuer: partyId,
        recipient: partyId,
        assetId,
        assetType: { tag: assetType, value: {} },
        amount: amount.toString(),
        valueUSD: valueUSD.toString()
      }
    });
    // Accept the issuance to create the asset
    const acceptResult = await this.sdk.cantonExercise({
      contractId: result.contractId,
      templateId: this.templateId('Assets', 'AssetIssuance'),
      choice: 'Accept',
      argument: {}
    });
    const event = acceptResult.events?.find(e => e.templateId?.includes('TokenizedAsset'));
    return event?.contractId || result.contractId;
  }

  // Margin verification operations
  async getMarginRequirements(): Promise<MarginRequirement[]> {
    const contracts = await this.sdk.cantonQuery<MarginRequirementPayload>({
      templateId: this.templateId('MarginVerification', 'MarginRequirement'),
    });
    return contracts.map(c => this.mapMarginRequirement(c));
  }

  async createMarginRequirement(
    positionId: string,
    counterparty: string,
    requiredMargin: number,
    vaultId: string
  ): Promise<string> {
    const partyId = await this.sdk.getPartyId();
    const result = await this.sdk.cantonCreate({
      templateId: this.templateId('MarginVerification', 'MarginRequirement'),
      payload: {
        provider: partyId,
        counterparty,
        operator: partyId,
        positionId,
        requiredMargin: requiredMargin.toString(),
        vaultId,
        verificationStatus: { tag: 'Pending', value: {} },
        lastChecked: null
      }
    });
    return result.contractId;
  }

  async verifyMargin(marginRequirementId: string, vaultContractId: string): Promise<MarginVerifyResult> {
    const result = await this.sdk.cantonExercise({
      contractId: marginRequirementId,
      templateId: this.templateId('MarginVerification', 'MarginRequirement'),
      choice: 'VerifyMargin',
      argument: {
        vaultCid: vaultContractId,
        currentTime: new Date().toISOString()
      }
    });

    // Generate a mock ZK proof for demo purposes
    const proof = this.generateMockZKProof();

    // Extract verification status from the exercise result
    const exerciseResult = result.exerciseResult as { verificationStatus?: { tag: string } } | undefined;

    return {
      status: exerciseResult?.verificationStatus?.tag || 'Unknown',
      proof,
      timestamp: new Date().toISOString()
    };
  }

  // Margin call operations
  async getActiveMarginCalls(): Promise<MarginCall[]> {
    const contracts = await this.sdk.cantonQuery<MarginCallPayload>({
      templateId: this.templateId('MarginVerification', 'MarginCall'),
    });
    return contracts
      .filter(c => c.payload.status.tag === 'Active')
      .map(c => this.mapMarginCall(c));
  }

  async getAllMarginCalls(): Promise<MarginCall[]> {
    const contracts = await this.sdk.cantonQuery<MarginCallPayload>({
      templateId: this.templateId('MarginVerification', 'MarginCall'),
    });
    return contracts.map(c => this.mapMarginCall(c));
  }

  async triggerMarginCall(marginRequirementId: string): Promise<string> {
    const result = await this.sdk.cantonExercise({
      contractId: marginRequirementId,
      templateId: this.templateId('MarginVerification', 'MarginRequirement'),
      choice: 'TriggerMarginCall',
      argument: {}
    });
    const event = result.events?.find(e => e.templateId?.includes('MarginCall'));
    return event?.contractId || '';
  }

  async settleMarginCall(
    marginCallId: string,
    vaultContractId: string,
    settledAssets: AssetPosition[]
  ): Promise<void> {
    await this.sdk.cantonExercise({
      contractId: marginCallId,
      templateId: this.templateId('MarginVerification', 'MarginCall'),
      choice: 'SettleMarginCall',
      argument: {
        vaultCid: vaultContractId,
        settledAssets,
        settlementTime: new Date().toISOString()
      }
    });
  }

  async cancelMarginCall(marginCallId: string): Promise<void> {
    await this.sdk.cantonExercise({
      contractId: marginCallId,
      templateId: this.templateId('MarginVerification', 'MarginCall'),
      choice: 'CancelMarginCall',
      argument: {}
    });
  }

  // Helper functions to map contract payloads to display types
  private mapVault(contract: { contractId: string; payload: VaultPayload }): Vault {
    const collateralAssets = contract.payload.collateralAssets.map(a => ({
      assetId: a.assetId,
      assetType: typeof a.assetType === 'object' ? (a.assetType as { tag: string }).tag : a.assetType,
      amount: parseFloat(a.amount),
      valueUSD: parseFloat(a.valueUSD)
    }));

    const totalValue = collateralAssets.reduce((sum, a) => sum + a.valueUSD, 0);

    return {
      contractId: contract.contractId,
      vaultId: contract.payload.vaultId,
      owner: contract.payload.owner,
      operator: contract.payload.operator,
      collateralAssets,
      linkedPositions: contract.payload.linkedPositions,
      totalValue
    };
  }

  private mapAsset(contract: { contractId: string; payload: TokenizedAssetPayload }): Asset {
    return {
      contractId: contract.contractId,
      assetId: contract.payload.assetId,
      assetType: typeof contract.payload.assetType === 'object'
        ? (contract.payload.assetType as { tag: string }).tag
        : contract.payload.assetType,
      owner: contract.payload.owner,
      issuer: contract.payload.issuer,
      amount: parseFloat(contract.payload.amount),
      valueUSD: parseFloat(contract.payload.valueUSD)
    };
  }

  private mapMarginRequirement(contract: { contractId: string; payload: MarginRequirementPayload }): MarginRequirement {
    return {
      contractId: contract.contractId,
      positionId: contract.payload.positionId,
      provider: contract.payload.provider,
      counterparty: contract.payload.counterparty,
      vaultId: contract.payload.vaultId,
      requiredMargin: parseFloat(contract.payload.requiredMargin),
      status: contract.payload.verificationStatus.tag,
      lastChecked: contract.payload.lastChecked
    };
  }

  private mapMarginCall(contract: { contractId: string; payload: MarginCallPayload }): MarginCall {
    return {
      contractId: contract.contractId,
      positionId: contract.payload.positionId,
      provider: contract.payload.provider,
      counterparty: contract.payload.counterparty,
      requiredAmount: parseFloat(contract.payload.requiredAmount),
      status: contract.payload.status.tag,
      createdAt: contract.payload.callTime
    };
  }

  // Generate a mock ZK proof (for demo purposes)
  private generateMockZKProof(): string {
    const randomBytes = new Uint8Array(64);
    crypto.getRandomValues(randomBytes);
    return Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
