#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SCRIPT_DIR/build"
OUTPUT_DIR="$PROJECT_ROOT/public/zk"

echo "=== PrivaMargin ZK Circuit Build ==="

# Prerequisites check
command -v npx >/dev/null 2>&1 || { echo "ERROR: npx not found."; exit 1; }

# Clean
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$OUTPUT_DIR"

# Step 1: Compile the circuit using circom2 npm package
echo "[1/5] Compiling circuit..."
npx circom2 "$SCRIPT_DIR/ltv_verifier.circom" \
  --r1cs --wasm --sym \
  -o "$BUILD_DIR" \
  -l "$PROJECT_ROOT/node_modules"

echo "  R1CS generated"

# Step 2: Powers of Tau ceremony (phase 1)
echo "[2/5] Powers of Tau (phase 1)..."
ENTROPY1=$(dd if=/dev/urandom bs=64 count=1 2>/dev/null | xxd -p -c 128)
ENTROPY2=$(dd if=/dev/urandom bs=64 count=1 2>/dev/null | xxd -p -c 128)

npx snarkjs powersoftau new bn128 14 "$BUILD_DIR/pot14_0000.ptau" -v
echo "$ENTROPY1" | npx snarkjs powersoftau contribute "$BUILD_DIR/pot14_0000.ptau" "$BUILD_DIR/pot14_0001.ptau" \
  --name="PrivaMargin contribution" -v
npx snarkjs powersoftau prepare phase2 "$BUILD_DIR/pot14_0001.ptau" "$BUILD_DIR/pot14_final.ptau" -v

# Step 3: Circuit-specific setup (phase 2 — Groth16)
echo "[3/5] Groth16 setup (phase 2)..."
npx snarkjs groth16 setup "$BUILD_DIR/ltv_verifier.r1cs" "$BUILD_DIR/pot14_final.ptau" \
  "$BUILD_DIR/ltv_verifier_0000.zkey"
echo "$ENTROPY2" | npx snarkjs zkey contribute "$BUILD_DIR/ltv_verifier_0000.zkey" "$BUILD_DIR/ltv_verifier_final.zkey" \
  --name="PrivaMargin phase2" -v

# Step 4: Export verification key
echo "[4/5] Exporting verification key..."
npx snarkjs zkey export verificationkey "$BUILD_DIR/ltv_verifier_final.zkey" \
  "$BUILD_DIR/verification_key.json"

# Step 5: Copy artifacts to public/zk/
echo "[5/5] Copying artifacts to public/zk/..."
cp "$BUILD_DIR/ltv_verifier_js/ltv_verifier.wasm" "$OUTPUT_DIR/ltv_verifier.wasm"
cp "$BUILD_DIR/ltv_verifier_final.zkey" "$OUTPUT_DIR/ltv_verifier_final.zkey"
cp "$BUILD_DIR/verification_key.json" "$OUTPUT_DIR/verification_key.json"

echo ""
echo "=== Build complete ==="
echo "Artifacts in $OUTPUT_DIR:"
ls -lh "$OUTPUT_DIR"/
echo ""
echo "WASM size: $(du -sh "$OUTPUT_DIR/ltv_verifier.wasm" | cut -f1)"
echo "zkey size: $(du -sh "$OUTPUT_DIR/ltv_verifier_final.zkey" | cut -f1)"
