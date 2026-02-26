/**
 * ZK Proof Service — Groth16 proof generation and verification for LTV computation.
 *
 * Uses snarkjs to generate proofs in-browser (WASM) and verify them.
 * Circuit artifacts (WASM, zkey, verification key) are loaded from /zk/ static assets.
 */

import * as snarkjs from 'snarkjs';
import type { Groth16Proof } from 'snarkjs';

// Paths to static ZK artifacts (served from public/zk/)
const WASM_PATH = '/zk/ltv_verifier.wasm';
const ZKEY_PATH = '/zk/ltv_verifier_final.zkey';
const VKEY_PATH = '/zk/verification_key.json';

// Max assets supported by the circuit (must match circuit instantiation)
const MAX_ASSETS = 10;

// Cache the verification key after first load
let cachedVKey: Record<string, unknown> | null = null;

export interface ZKProofResult {
  proof: Groth16Proof;
  publicSignals: string[];
  computedLTVBps: number;
  isLiquidatable: boolean;
  proofTimeMs: number;
}

export interface ZKVerificationInput {
  assetValuesCents: number[];     // Up to 10 values, each in USD cents
  notionalValueCents: number;     // Notional in USD cents
  ltvThresholdBps: number;        // Threshold in basis points (e.g., 8000 = 80%)
}

/** Convert USD dollar amount to cents (integer). */
export function usdToCents(usd: number): number {
  return Math.round(usd * 100);
}

/** Convert decimal LTV (e.g., 0.8) to basis points (e.g., 8000). */
export function ltvToBps(ltvDecimal: number): number {
  return Math.round(ltvDecimal * 10000);
}

/**
 * Generate a Groth16 ZK proof for LTV verification.
 *
 * The fund calls this with their private asset values.
 * The proof attests that the computedLTVBps is correct without revealing individual assets.
 */
export async function generateLTVProof(input: ZKVerificationInput): Promise<ZKProofResult> {
  const { assetValuesCents, notionalValueCents, ltvThresholdBps } = input;

  // Circuit has fixed-width Num2Bits constraints. The LTV output (bps) and intermediates
  // must fit within the circuit's bit width. Extreme LTV ratios (e.g., collateral ≈ $0
  // vs large notional) produce values that overflow, crashing the witness generator.
  // Skip proof generation if estimated LTV exceeds circuit capacity.
  const MAX_LTV_BPS = 50000; // 500% — well above any meaningful threshold
  const totalCollateralCents = assetValuesCents.reduce((s, v) => s + v, 0);
  if (totalCollateralCents <= 0) {
    throw new Error('Cannot generate ZK proof: collateral is zero');
  }
  const estimatedLTVBps = Math.round(notionalValueCents * 10000 / totalCollateralCents);
  if (estimatedLTVBps > MAX_LTV_BPS) {
    throw new Error(
      `LTV too extreme for circuit (${estimatedLTVBps} bps > ${MAX_LTV_BPS} bps limit). ` +
      `Collateral is negligible relative to notional.`
    );
  }

  // Pad asset values to MAX_ASSETS with zeros
  const paddedAssets = new Array(MAX_ASSETS).fill('0');
  for (let i = 0; i < Math.min(assetValuesCents.length, MAX_ASSETS); i++) {
    paddedAssets[i] = String(Math.round(assetValuesCents[i]));
  }

  // Build circuit input (all values as strings for snarkjs)
  const circuitInput = {
    assetValues: paddedAssets,
    notionalValueCents: String(Math.round(notionalValueCents)),
    ltvThresholdBps: String(Math.round(ltvThresholdBps)),
  };

  const startTime = performance.now();

  // Generate proof (loads WASM and zkey from static assets)
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    WASM_PATH,
    ZKEY_PATH,
  );

  const proofTimeMs = Math.round(performance.now() - startTime);

  // Public signal ordering (from circuit):
  //   [0] = computedLTVBps (output)
  //   [1] = isLiquidatable (output)
  //   [2] = notionalValueCents (public input)
  //   [3] = ltvThresholdBps (public input)
  const computedLTVBps = parseInt(publicSignals[0], 10);
  const isLiquidatable = publicSignals[1] === '1';

  return { proof, publicSignals, computedLTVBps, isLiquidatable, proofTimeMs };
}

/**
 * Verify a Groth16 ZK proof.
 *
 * The broker calls this to independently verify a proof received from the fund.
 * Only needs the proof and publicSignals — no private data required.
 */
export async function verifyLTVProof(
  proof: Groth16Proof,
  publicSignals: string[],
): Promise<boolean> {
  if (!cachedVKey) {
    const response = await fetch(VKEY_PATH);
    cachedVKey = await response.json();
  }
  return snarkjs.groth16.verify(cachedVKey!, publicSignals, proof);
}

/**
 * Generate a SHA-256 hex hash of the proof for display.
 */
export async function proofHash(proof: Groth16Proof): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(proof));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Check if ZK artifacts are available (for graceful fallback).
 */
export async function isZKAvailable(): Promise<boolean> {
  try {
    const [wasmRes, zkeyRes, vkeyRes] = await Promise.all([
      fetch(WASM_PATH, { method: 'HEAD' }),
      fetch(ZKEY_PATH, { method: 'HEAD' }),
      fetch(VKEY_PATH, { method: 'HEAD' }),
    ]);
    return wasmRes.ok && zkeyRes.ok && vkeyRes.ok;
  } catch {
    return false;
  }
}
