#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_SRC="$ROOT/engine-src"
SITE_KATAGO="$ROOT/site/katago"
EMSDK_DIR="${EMSDK_DIR:-$HOME/emsdk}"

if [ ! -f "$EMSDK_DIR/emsdk_env.sh" ]; then
  echo "ไม่พบ Emscripten SDK ที่ $EMSDK_DIR"
  echo "ติดตั้ง emsdk ก่อน หรือกำหนด EMSDK_DIR ให้ชี้ไปยังโฟลเดอร์ emsdk"
  exit 1
fi

mkdir -p "$SITE_KATAGO"
cd "$ENGINE_SRC"
echo "==> Building threaded KataGo WASM (real KataGo Search)"
EMSDK_DIR="$EMSDK_DIR" MT=1 KATA_PTHREAD_POOL_SIZE=9 bash scripts/build-eval.sh

echo "==> Copying browser engine and model into Netlify site"
cp web/demo/kataeval-mt.js "$SITE_KATAGO/"
cp web/demo/kataeval-mt.wasm "$SITE_KATAGO/"
cp web/demo/kata-worker.js "$SITE_KATAGO/"
cp web/demo/model-b10c128.bin.gz "$SITE_KATAGO/"

echo "==> Done. Deploy the CONTENTS of site/ to Netlify."
ls -lh "$SITE_KATAGO"/kataeval-mt.* "$SITE_KATAGO"/model-b10c128.bin.gz
