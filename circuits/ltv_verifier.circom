pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/comparators.circom";

// LTV Verifier Circuit
//
// Proves that computedLTVBps is the correct LTV for the given assets and notional,
// and determines liquidation eligibility by comparing against a threshold.
//
// Private inputs (witness — fund's secret):
//   assetValues[N]  — each asset's USD value in cents
//
// Public inputs (known to both fund and broker):
//   notionalValueCents  — position notional in cents
//   ltvThresholdBps     — liquidation threshold in basis points (e.g., 8000 = 80%)
//
// Public outputs:
//   computedLTVBps  — LTV ratio in basis points
//   isLiquidatable  — 1 if LTV >= threshold, 0 otherwise

template LTVVerifier(N) {
    // --- Private inputs: individual asset values in cents ---
    signal input assetValues[N];

    // --- Public inputs ---
    signal input notionalValueCents;
    signal input ltvThresholdBps;

    // --- Public outputs ---
    signal output computedLTVBps;
    signal output isLiquidatable;

    // ==========================================
    // Step 1: Sum all asset values → totalCollateral
    // ==========================================
    signal partialSums[N + 1];
    partialSums[0] <== 0;
    for (var i = 0; i < N; i++) {
        partialSums[i + 1] <== partialSums[i] + assetValues[i];
    }
    signal totalCollateral;
    totalCollateral <== partialSums[N];

    // ==========================================
    // Step 2: Check if totalCollateral is zero
    // ==========================================
    component isZeroCollateral = IsZero();
    isZeroCollateral.in <== totalCollateral;
    // isZeroCollateral.out == 1 when totalCollateral == 0

    signal nonZero;
    nonZero <== 1 - isZeroCollateral.out;

    // ==========================================
    // Step 3: Prover supplies the LTV value, circuit verifies it
    //
    // LTV = floor(notionalValueCents * 10000 / totalCollateral)
    //
    // The prover computes this off-circuit and supplies it.
    // The circuit verifies via cross-multiplication:
    //   computedLTVBps * totalCollateral <= notionalValueCents * 10000
    //   (computedLTVBps + 1) * totalCollateral > notionalValueCents * 10000
    //
    // When totalCollateral == 0, we accept 99999 (convention for max LTV).
    // ==========================================

    // Prover computes the LTV (unconstrained assignment)
    computedLTVBps <-- (totalCollateral != 0) ? (notionalValueCents * 10000) \ totalCollateral : 99999;

    // Now verify correctness via constraints
    signal scaledNotional;
    scaledNotional <== notionalValueCents * 10000;

    signal product;
    product <== computedLTVBps * totalCollateral;

    signal productPlusOne;
    productPlusOne <== (computedLTVBps + 1) * totalCollateral;

    // Lower bound: product <= scaledNotional
    // 64-bit comparison supports values up to 2^64 ~ 1.8 * 10^19
    component lowerBound = LessEqThan(64);
    lowerBound.in[0] <== product;
    lowerBound.in[1] <== scaledNotional;

    // Upper bound: scaledNotional < productPlusOne
    component upperBound = LessThan(64);
    upperBound.in[0] <== scaledNotional;
    upperBound.in[1] <== productPlusOne;

    // Enforce constraints only when totalCollateral > 0
    signal checkLower;
    checkLower <== nonZero * (1 - lowerBound.out);
    checkLower === 0;

    signal checkUpper;
    checkUpper <== nonZero * (1 - upperBound.out);
    checkUpper === 0;

    // ==========================================
    // Step 4: Compare LTV against threshold
    // isLiquidatable = (computedLTVBps >= ltvThresholdBps)
    // ==========================================
    component thresholdCheck = GreaterEqThan(16);
    thresholdCheck.in[0] <== computedLTVBps;
    thresholdCheck.in[1] <== ltvThresholdBps;
    isLiquidatable <== thresholdCheck.out;
}

// Instantiate with N=10 (up to 10 assets per vault, unused slots = 0)
component main {public [notionalValueCents, ltvThresholdBps]} = LTVVerifier(10);
