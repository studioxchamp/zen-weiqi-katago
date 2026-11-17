#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_SRC="$ROOT/engine-src"
SITE_KATAGO="$ROOT/site/katago"

mkdir -p "$SITE_KATAGO"
cd "$ENGINE_SRC"

echo "==> Building threaded KataGo WASM (WebGPU + Multi-thread)"
MT=1 bash scripts/build-eval.sh

echo "==> Copying browser engine into site/katago/"
cp web/demo/kataeval-mt.js "$SITE_KATAGO/"
cp web/demo/kataeval-mt.wasm "$SITE_KATAGO/"
cp web/demo/kata-worker.js "$SITE_KATAGO/"

echo "==> Done! Files in site/katago/:"
ls -lh "$SITE_KATAGO"/