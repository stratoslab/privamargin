/**
 * EVM Escrow Contract — deployment bytecode, ABI encoding, deploy/poll helpers.
 *
 * Pre-compiled from contracts/VaultEscrow.sol and contracts/DepositRelay.sol
 * (solc 0.8.34, optimized). No ethers.js dependency — hand-rolled ABI encoding.
 */

import { getSDK } from '@stratos-wallet/sdk';

// ---------------------------------------------------------------------------
// Network mode — testnet vs mainnet toggle
// ---------------------------------------------------------------------------
export type NetworkMode = 'testnet' | 'mainnet';

// Read from Vite env (VITE_NETWORK_MODE). Cast through unknown to satisfy strict TS
// when vite/client types are not declared.
const _envMode = (
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_NETWORK_MODE
) as NetworkMode | undefined;
export const NETWORK_MODE: NetworkMode = _envMode || 'testnet';

export const AVAILABLE_CHAINS: Record<NetworkMode, number[]> = {
  testnet: [11155111],
  mainnet: [1, 8453],
};
export const DEFAULT_CHAIN_ID: Record<NetworkMode, number> = {
  testnet: 11155111,
  mainnet: 1,
};
export function getDefaultChainId(): number { return DEFAULT_CHAIN_ID[NETWORK_MODE]; }
export function getAvailableChainIds(): number[] { return AVAILABLE_CHAINS[NETWORK_MODE]; }

// ---------------------------------------------------------------------------
// Centralized chain name ↔ ID mappings (eliminates 3x duplication in api.ts)
// ---------------------------------------------------------------------------
export const CHAIN_NAME_TO_ID: Record<string, number> = {
  'Ethereum': 1,
  'Sepolia': 11155111,
  'Base': 8453,
  'Base Sepolia': 84532,
};
export const CHAIN_ID_TO_NAME: Record<number, string> = {
  1: 'Ethereum',
  11155111: 'Sepolia',
  8453: 'Base',
  84532: 'Base Sepolia',
};

// Map wallet SDK chainType → all supported chain IDs for that type.
// A single EVM address works on all EVM-compatible chains (mainnet + testnets).
export const CHAIN_TYPE_TO_IDS: Record<string, number[]> = {
  evm: [1, 11155111],        // Ethereum mainnet + Sepolia
  base: [8453, 84532],       // Base mainnet + Base Sepolia
};

// ---------------------------------------------------------------------------
// Compiled bytecode — VaultEscrow
// (from `solcjs --bin --optimize contracts/VaultEscrow.sol`)
// Constructor takes 4 address arguments:
//   _liquidator, _swapRouter, _weth, _stablecoin
// ---------------------------------------------------------------------------
export const VAULT_ESCROW_BYTECODE =
  '0x610120604052348015610010575f5ffd5b50604051610d54380380610d5483398101604081905261002f91610071565b336080526001600160a01b0393841660a05291831660c052821660e05216610100526100c2565b80516001600160a01b038116811461006c575f5ffd5b919050565b5f5f5f5f60808587031215610084575f5ffd5b61008d85610056565b935061009b60208601610056565b92506100a960408601610056565b91506100b760608601610056565b905092959194509250565b60805160a05160c05160e05161010051610c0f6101455f395f8181610264015261049601525f81816101230152818161033d015281816103ee015261047101525f8181610231015281816103bf015261053101525f818161016e01528181610291015261093001525f81816101fe015281816105f301526107a80152610c0f5ff3fe608060405260043610610092575f3560e01c80634782f779116100575780634782f779146101af578063655f26b4146101ce5780638da5cb5b146101ed578063c31c9c0714610220578063e9cbd82214610253575f5ffd5b80630710285c146100d257806312065fe0146100f35780633fc8cef3146101125780634046ebae1461015d57806344004cc114610190575f5ffd5b366100ce5760405134815233907f2da466a7b24304f47e87fa2e1e5a81b9831ce54fec19055ce277ca2f39ba42c49060200160405180910390a2005b5f5ffd5b3480156100dd575f5ffd5b506100f16100ec366004610aec565b610286565b005b3480156100fe575f5ffd5b506040514781526020015b60405180910390f35b34801561011d575f5ffd5b506101457f000000000000000000000000000000000000000000000000000000000000000081565b6040516001600160a01b039091168152602001610109565b348015610168575f5ffd5b506101457f000000000000000000000000000000000000000000000000000000000000000081565b34801561019b575f5ffd5b506100f16101aa366004610b1e565b6105e8565b3480156101ba575f5ffd5b506100f16101c9366004610b5c565b61079d565b3480156101d9575f5ffd5b506100f16101e8366004610b1e565b610925565b3480156101f8575f5ffd5b506101457f000000000000000000000000000000000000000000000000000000000000000081565b34801561022b575f5ffd5b506101457f000000000000000000000000000000000000000000000000000000000000000081565b34801561025e575f5ffd5b506101457f000000000000000000000000000000000000000000000000000000000000000081565b336001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016146102f45760405162461bcd60e51b815260206004820152600e60248201526d2737ba103634b8bab4b230ba37b960911b60448201526064015b60405180910390fd5b8147101561033b5760405162461bcd60e51b8152602060048201526014602482015273496e73756666696369656e742062616c616e636560601b60448201526064016102eb565b7f00000000000000000000000000000000000000000000000000000000000000006001600160a01b031663d0e30db0836040518263ffffffff1660e01b81526004015f604051808303818588803b158015610394575f5ffd5b505af11580156103a6573d5f5f3e3d5ffd5b505060405163095ea7b360e01b81526001600160a01b037f000000000000000000000000000000000000000000000000000000000000000081166004830152602482018790527f000000000000000000000000000000000000000000000000000000000000000016935063095ea7b3925060440190506020604051808303815f875af1158015610438573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061045c9190610b86565b506040805160e0810182526001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000811682527f0000000000000000000000000000000000000000000000000000000000000000811660208301908152610bb8838501908152878316606085019081526080850188815260a086018881525f60c0880181815298516304e45aaf60e01b8152975187166004890152945186166024880152925162ffffff1660448701529051841660648601525160848501525160a48401529251811660c48301527f000000000000000000000000000000000000000000000000000000000000000016906304e45aaf9060e4016020604051808303815f875af1158015610577573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061059b9190610bac565b60408051858152602081018390529192506001600160a01b038616917f09c223cfcd8c93e245f558f5f8de755fc0930fd9bc257441155ef5d54a170e0f910160405180910390a250505050565b336001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000161461064c5760405162461bcd60e51b81526020600482015260096024820152682737ba1037bbb732b960b91b60448201526064016102eb565b604080516001600160a01b038481166024830152604480830185905283518084039091018152606490920183526020820180516001600160e01b031663a9059cbb60e01b17905291515f928392908716916106a79190610bc3565b5f604051808303815f865af19150503d805f81146106e0576040519150601f19603f3d011682016040523d82523d5f602084013e6106e5565b606091505b509150915081801561070f57508051158061070f57508080602001905181019061070f9190610b86565b6107535760405162461bcd60e51b8152602060048201526015602482015274115490cc8c081d1c985b9cd9995c8819985a5b1959605a1b60448201526064016102eb565b836001600160a01b03167f7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d58460405161078e91815260200190565b60405180910390a25050505050565b336001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016146108015760405162461bcd60e51b81526020600482015260096024820152682737ba1037bbb732b960b91b60448201526064016102eb565b804710156108485760405162461bcd60e51b8152602060048201526014602482015273496e73756666696369656e742062616c616e636560601b60448201526064016102eb565b5f826001600160a01b0316826040515f6040518083038185875af1925050503d805f8114610891576040519150601f19603f3d011682016040523d82523d5f602084013e610896565b606091505b50509050806108dd5760405162461bcd60e51b8152602060048201526013602482015272115512081d1c985b9cd9995c8819985a5b1959606a1b60448201526064016102eb565b826001600160a01b03167f7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d58360405161091891815260200190565b60405180910390a2505050565b336001600160a01b037f0000000000000000000000000000000000000000000000000000000000000000161461098e5760405162461bcd60e51b815260206004820152600e60248201526d2737ba103634b8bab4b230ba37b960911b60448201526064016102eb565b604080516001600160a01b038481166024830152604480830185905283518084039091018152606490920183526020820180516001600160e01b031663a9059cbb60e01b17905291515f928392908716916109e99190610bc3565b5f604051808303815f865af19150503d805f8114610a22576040519150601f19603f3d011682016040523d82523d5f602084013e610a27565b606091505b5091509150818015610a51575080511580610a51575080806020019051810190610a519190610b86565b610a955760405162461bcd60e51b8152602060048201526015602482015274115490cc8c081d1c985b9cd9995c8819985a5b1959605a1b60448201526064016102eb565b604080518481525f60208201526001600160a01b038616917f09c223cfcd8c93e245f558f5f8de755fc0930fd9bc257441155ef5d54a170e0f910161078e565b6001600160a01b0381168114610ae9575f5ffd5b50565b5f5f5f60608486031215610afe575f5ffd5b8335610b0981610ad5565b95602085013595506040909401359392505050565b5f5f5f60608486031215610b30575f5ffd5b8335610b3b81610ad5565b92506020840135610b4b81610ad5565b929592945050506040919091013590565b5f5f60408385031215610b6d575f5ffd5b8235610b7881610ad5565b946020939093013593505050565b5f60208284031215610b96575f5ffd5b81518015158114610ba5575f5ffd5b9392505050565b5f60208284031215610bbc575f5ffd5b5051919050565b5f82518060208501845e5f92019182525091905056fea264697066735822122029461dea371ba2513e0a6bbb4fb98b38a7b578c8f0d6d93af09c4b4a15d8b60a64736f6c63430008220033';

// ---------------------------------------------------------------------------
// Function selectors (first 4 bytes of keccak256 of the function signature)
// ---------------------------------------------------------------------------
// withdrawETH(address,uint256)            → 0x4782f779
// withdrawERC20(address,address,uint256)  → 0x44004cc1
// getBalance()                            → 0x12065fe0
// owner()                                 → 0x8da5cb5b
// liquidator()                            → 0x4046ebae
// liquidate(address,uint256,uint256)      → 0x0710285c
// liquidateERC20(address,address,uint256) → 0x655f26b4
// swapRouter()                            → 0xc31c9c07
// weth()                                  → 0x3fc8cef3
// stablecoin()                            → 0xe9cbd822
const SEL_WITHDRAW_ETH = '4782f779';
const SEL_WITHDRAW_ERC20 = '44004cc1';
const SEL_GET_BALANCE = '12065fe0';
const SEL_LIQUIDATE_ETH = '0710285c';
const SEL_LIQUIDATE_ERC20 = '655f26b4';

// ---------------------------------------------------------------------------
// Chain-specific contract addresses (Uniswap V3 SwapRouter, WETH, USDC)
// ---------------------------------------------------------------------------
export interface ChainConfig {
  swapRouter: string;
  weth: string;
  usdc: string;
  relay?: string;  // DepositRelay address (set at runtime after deploy)
}
export const CHAIN_CONFIG: Record<number, ChainConfig> = {
  1:        { swapRouter: '0xE592427A0AEce92De3Edee1F18E0157C05861564', weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  11155111: { swapRouter: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E', weth: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
  8453:     { swapRouter: '0x2626664c2603336E57B271c5C0b26F421741e481', weth: '0x4200000000000000000000000000000000000006', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  84532:    { swapRouter: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4', weth: '0x4200000000000000000000000000000000000006', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
};

// ---------------------------------------------------------------------------
// Compiled bytecode — DepositRelay
// (from `solcjs --bin --optimize contracts/DepositRelay.sol`)
// Constructor takes 1 address argument: _operator
// ---------------------------------------------------------------------------
export const DEPOSIT_RELAY_BYTECODE =
  '0x60a0604052348015600e575f5ffd5b50604051610779380380610779833981016040819052602b91603b565b6001600160a01b03166080526066565b5f60208284031215604a575f5ffd5b81516001600160a01b0381168114605f575f5ffd5b9392505050565b6080516106ee61008b5f395f818160ba0152818161015e015261047f01526106ee5ff3fe60806040526004361061004c575f3560e01c806312065fe01461008a578063570ca735146100a957806373f70407146100f457806397feb92614610115578063df61427e14610134575f5ffd5b36610086576040513481527fadb6a3fe015de6cf14b532348b91a6202eb862af051124a853b5935e034cfd7b9060200160405180910390a1005b5f5ffd5b348015610095575f5ffd5b506040514781526020015b60405180910390f35b3480156100b4575f5ffd5b506100dc7f000000000000000000000000000000000000000000000000000000000000000081565b6040516001600160a01b0390911681526020016100a0565b3480156100ff575f5ffd5b5061011361010e36600461061a565b610153565b005b348015610120575f5ffd5b5061011361012f366004610654565b61031a565b34801561013f575f5ffd5b5061011361014e366004610654565b610474565b336001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016146101bf5760405162461bcd60e51b815260206004820152600c60248201526b2737ba1037b832b930ba37b960a11b60448201526064015b60405180910390fd5b604080516001600160a01b038481166024830152604480830185905283518084039091018152606490920183526020820180516001600160e01b031663a9059cbb60e01b17905291515f9283929087169161021a919061067c565b5f604051808303815f865af19150503d805f8114610253576040519150601f19603f3d011682016040523d82523d5f602084013e610258565b606091505b50915091508180156102825750805115806102825750808060200190518101906102829190610692565b6102c65760405162461bcd60e51b8152602060048201526015602482015274115490cc8c081d1c985b9cd9995c8819985a5b1959605a1b60448201526064016101b6565b836001600160a01b0316856001600160a01b03167f35c455c9cc0036634037c52f7efb65518636cc890f50fe79e464d7e7e98952e18560405161030b91815260200190565b60405180910390a35050505050565b60408051336024820152306044820152606480820184905282518083039091018152608490910182526020810180516001600160e01b03166323b872dd60e01b17905290515f9182916001600160a01b038616916103779161067c565b5f604051808303815f865af19150503d805f81146103b0576040519150601f19603f3d011682016040523d82523d5f602084013e6103b5565b606091505b50915091508180156103df5750805115806103df5750808060200190518101906103df9190610692565b61042b5760405162461bcd60e51b815260206004820152601960248201527f4552433230207472616e7366657246726f6d206661696c65640000000000000060448201526064016101b6565b836001600160a01b03167fab79632de7fe1724598ce2214eaa326d90d48064d2d3397406ecc5769316a5f68460405161046691815260200190565b60405180910390a250505050565b336001600160a01b037f000000000000000000000000000000000000000000000000000000000000000016146104db5760405162461bcd60e51b815260206004820152600c60248201526b2737ba1037b832b930ba37b960a11b60448201526064016101b6565b804710156105225760405162461bcd60e51b8152602060048201526014602482015273496e73756666696369656e742062616c616e636560601b60448201526064016101b6565b5f826001600160a01b0316826040515f6040518083038185875af1925050503d805f811461056b576040519150601f19603f3d011682016040523d82523d5f602084013e610570565b606091505b50509050806105b75760405162461bcd60e51b8152602060048201526013602482015272115512081d1c985b9cd9995c8819985a5b1959606a1b60448201526064016101b6565b826001600160a01b03167f81dbed793c44e11f6f04d977bad497142f41559ca59d2bb099fbcb1762a75493836040516105f291815260200190565b60405180910390a2505050565b80356001600160a01b0381168114610615575f5ffd5b919050565b5f5f5f6060848603121561062c575f5ffd5b610635846105ff565b9250610643602085016105ff565b929592945050506040919091013590565b5f5f60408385031215610665575f5ffd5b61066e836105ff565b946020939093013593505050565b5f82518060208501845e5f920191825250919050565b5f602082840312156106a2575f5ffd5b815180151581146106b1575f5ffd5b939250505056fea264697066735822122035215c8dad7f0cd44cd5cbdb56ac537b6902048c1781080be483f7ccfa54758b64736f6c63430008220033';

// ---------------------------------------------------------------------------
// DepositRelay function selectors
// ---------------------------------------------------------------------------
// depositERC20(address,uint256)            → 0x97feb926
// forwardETH(address,uint256)              → 0xdf61427e
// forwardERC20(address,address,uint256)    → 0x73f70407
// getBalance()                             → 0x12065fe0
// operator()                               → 0x570ca735
const SEL_DEPOSIT_ERC20 = '97feb926';
const SEL_FORWARD_ETH = 'df61427e';
const SEL_FORWARD_ERC20 = '73f70407';
const SEL_ERC20_APPROVE = '095ea7b3';

// ---------------------------------------------------------------------------
// ABI encoding helpers (no ethers.js — just hex padding)
// ---------------------------------------------------------------------------

/** Pad a hex address to 32 bytes (64 hex chars), left-padded with zeros */
export function padAddress(addr: string): string {
  const clean = addr.startsWith('0x') ? addr.slice(2) : addr;
  return clean.toLowerCase().padStart(64, '0');
}

/** Encode a uint256 (number or bigint) as 32 bytes hex */
export function padUint256(value: bigint | number | string): string {
  let n: bigint;
  if (typeof value === 'string') {
    n = value.startsWith('0x') ? BigInt(value) : BigInt(value);
  } else {
    n = BigInt(value);
  }
  return n.toString(16).padStart(64, '0');
}

/** Encode withdrawETH(address payable to, uint256 amount) call data */
export function encodeWithdrawETH(to: string, amountWei: bigint | string): string {
  return '0x' + SEL_WITHDRAW_ETH + padAddress(to) + padUint256(amountWei);
}

/** Encode withdrawERC20(address token, address to, uint256 amount) call data */
export function encodeWithdrawERC20(token: string, to: string, amount: bigint | string): string {
  return '0x' + SEL_WITHDRAW_ERC20 + padAddress(token) + padAddress(to) + padUint256(amount);
}

/** Encode getBalance() call data */
export function encodeGetBalance(): string {
  return '0x' + SEL_GET_BALANCE;
}

/** Encode liquidate(address to, uint256 amount, uint256 amountOutMinimum) call data */
export function encodeLiquidateETH(to: string, amountWei: bigint | string, amountOutMin: bigint | string): string {
  return '0x' + SEL_LIQUIDATE_ETH + padAddress(to) + padUint256(amountWei) + padUint256(amountOutMin);
}

/** Encode liquidateERC20(address token, address to, uint256 amount) call data */
export function encodeLiquidateERC20(token: string, to: string, amount: bigint | string): string {
  return '0x' + SEL_LIQUIDATE_ERC20 + padAddress(token) + padAddress(to) + padUint256(amount);
}

// ---------------------------------------------------------------------------
// DepositRelay ABI encoders
// ---------------------------------------------------------------------------

/** Encode depositERC20(address token, uint256 amount) call data — for fund calling relay */
export function encodeDepositERC20(token: string, amount: bigint | string): string {
  return '0x' + SEL_DEPOSIT_ERC20 + padAddress(token) + padUint256(amount);
}

/** Encode forwardETH(address to, uint256 amount) call data — for operator forwarding */
export function encodeForwardETH(to: string, amountWei: bigint | string): string {
  return '0x' + SEL_FORWARD_ETH + padAddress(to) + padUint256(amountWei);
}

/** Encode forwardERC20(address token, address to, uint256 amount) call data — for operator forwarding */
export function encodeForwardERC20(token: string, to: string, amount: bigint | string): string {
  return '0x' + SEL_FORWARD_ERC20 + padAddress(token) + padAddress(to) + padUint256(amount);
}

/** Encode ERC20 approve(address spender, uint256 amount) call data */
export function encodeERC20Approve(spender: string, amount: bigint | string): string {
  return '0x' + SEL_ERC20_APPROVE + padAddress(spender) + padUint256(amount);
}

// ---------------------------------------------------------------------------
// Deploy + poll helpers
// ---------------------------------------------------------------------------

/**
 * Poll `getTransactionReceipt` until the receipt appears (or timeout).
 * Returns the receipt object (including `contractAddress` for deployment txs).
 */
export async function pollForContractAddress(
  sdk: ReturnType<typeof getSDK>,
  txHash: string,
  chainId: number,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<{ contractAddress: string; status: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const receipt = await sdk.getTransactionReceipt(txHash, chainId);
      if (receipt && receipt.contractAddress) {
        return {
          contractAddress: receipt.contractAddress as string,
          status: receipt.status as string,
        };
      }
    } catch {
      // receipt not yet available — retry
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for contract deployment receipt (tx: ${txHash})`);
}

/**
 * Deploy a VaultEscrow contract on the given EVM chain.
 *
 * 1. Sends a contract-creation transaction (no `to` address, data = bytecode + constructor args).
 * 2. Polls for the transaction receipt to obtain the deployed contract address.
 *
 * @param liquidatorAddress — EVM address set as the immutable liquidator on the escrow contract.
 * @param swapRouterAddress — Uniswap V3 SwapRouter address for the target chain.
 * @param wethAddress — WETH contract address for the target chain.
 * @param stablecoinAddress — USDC (or other stablecoin) address for the target chain.
 */
export async function deployEscrowContract(
  sdk: ReturnType<typeof getSDK>,
  chainId: number,
  liquidatorAddress: string,
  swapRouterAddress: string,
  wethAddress: string,
  stablecoinAddress: string
): Promise<{ contractAddress: string; txHash: string }> {
  // Append constructor arguments (4 addresses) to bytecode
  const deployData = VAULT_ESCROW_BYTECODE
    + padAddress(liquidatorAddress)
    + padAddress(swapRouterAddress)
    + padAddress(wethAddress)
    + padAddress(stablecoinAddress);

  // Send deployment transaction (to is omitted → contract creation)
  const result = await sdk.sendEVMTransaction({
    transaction: {
      data: deployData,
      chainId,
    },
  });

  const txHash = result.transactionHash;
  console.log('[EVM Escrow] Deploy tx sent:', txHash);

  // Poll for receipt to get the deployed contract address
  const receipt = await pollForContractAddress(sdk, txHash, chainId);
  console.log('[EVM Escrow] Contract deployed at:', receipt.contractAddress);

  return {
    contractAddress: receipt.contractAddress,
    txHash,
  };
}

/**
 * Deploy a DepositRelay contract on the given EVM chain.
 *
 * One relay per chain — shared pool that breaks depositor→escrow traceability.
 * Constructor takes a single address argument: the operator.
 */
export async function deployDepositRelay(
  sdk: ReturnType<typeof getSDK>,
  chainId: number,
  operatorAddress: string
): Promise<{ contractAddress: string; txHash: string }> {
  const deployData = DEPOSIT_RELAY_BYTECODE + padAddress(operatorAddress);

  const result = await sdk.sendEVMTransaction({
    transaction: {
      data: deployData,
      chainId,
    },
  });

  const txHash = result.transactionHash;
  console.log('[DepositRelay] Deploy tx sent:', txHash);

  const receipt = await pollForContractAddress(sdk, txHash, chainId);
  console.log('[DepositRelay] Contract deployed at:', receipt.contractAddress);

  return {
    contractAddress: receipt.contractAddress,
    txHash,
  };
}
