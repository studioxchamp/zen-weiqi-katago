#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_SRC="$ROOT/engine-src"
SITE_KATAGO="$ROOT/site/katago"
EMSDK_DIR="${EMSDK_DIR:-$HOME/emsdk}"

if [ ! -f "$EMSDK_DIR/emsdk_env.sh" ]; then
  echo "ไม่พบ Emscripten SDK ที่ $EMSDK_DIR"
  exit 1
fi

mkdir -p "$SITE_KATAGO"
cd "$ENGINE_SRC"

echo "==> Building threaded KataGo WASM (real KataGo Search)"
EMSDK_DIR="$EMSDK_DIR" MT=1 KATA_PTHREAD_POOL_SIZE=9 bash scripts/build-eval.sh

echo "==> Copying compiled browser engine"
for asset in kataeval-mt.js kataeval-mt.wasm kata-worker.js; do
  if [ ! -s "web/demo/$asset" ]; then
    echo "ERROR: ไม่พบไฟล์ที่ Build ต้องสร้าง: engine-src/web/demo/$asset"
    exit 1
  fi
  cp "web/demo/$asset" "$SITE_KATAGO/$asset"
done

# The source model files under cpp/tests/models are git-ignored in this
# integration repository. Keep the already supplied, tracked site model
# unless build-eval.sh generated a replacement in web/demo.
MODEL_SOURCE="web/demo/model-b10c128.bin.gz"
MODEL_TARGET="$SITE_KATAGO/model-b10c128.bin.gz"

if [ -s "$MODEL_SOURCE" ]; then
  cp "$MODEL_SOURCE" "$MODEL_TARGET"
  echo "==> Copied freshly bundled model from engine-src/web/demo"
elif [ -s "$MODEL_TARGET" ]; then
  echo "==> Using prebundled site model: site/katago/model-b10c128.bin.gz"
else
  echo "ERROR: ไม่พบโมเดล KataGo ทั้งใน engine-src/web/demo และ site/katago"
  echo "ต้องมีไฟล์ site/katago/model-b10c128.bin.gz อยู่ใน GitHub repository"
  exit 1
fi

echo "==> Build assets ready:"
ls -lh "$SITE_KATAGO/kataeval-mt.js" \
       "$SITE_KATAGO/kataeval-mt.wasm" \
       "$SITE_KATAGO/kata-worker.js" \
       "$SITE_KATAGO/model-b10c128.bin.gz"
echo "==> Done. Deploy the CONTENTS of site/ to Netlify."
