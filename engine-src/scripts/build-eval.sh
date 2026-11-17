#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/cpp"
OBJ="$ROOT/cpp/build-wasm/obj"; mkdir -p "$OBJ"

CFLAGS=( -O2 -fexceptions -DNO_GIT_REVISION -DHALF_ENABLE_CPP11_CFENV=0
         -I external -isystem external/filesystem-1.5.8/include
         --use-port=emdawnwebgpu -sUSE_ZLIB=1 )

MANIFESTS=( kataeval/sources.txt )
OUTNAME=kataeval
EXPORTS=_kgeLoad,_kgeEval,_kgeEvalSeq,_kgeEvalBatch,_kgeSearch,_kgeSetGumbel,_kgeSetPolicyOptimism,_kgeError,_kgeBoardSize,_kgeModelVersion,_kgeBackendIsGpu,_kgeSetForceCpu,_kgeSetFp16,_malloc,_free
LINKEXTRA=( -sINITIAL_MEMORY=64MB )
if [ "${MT:-0}" = 1 ]; then
  CFLAGS+=( -pthread -DKGE_THREADS )
  MANIFESTS+=( kataeval/sources-search.txt )
  OUTNAME=kataeval-mt
  EXPORTS="$EXPORTS,_kgeSearchKata,_kgeEvalSeqKata,_kgeSearchBegin,_kgePollAll,_kgePonderBegin,_kgeStopSearch,_kgeSetStrength,_kgeSetPolicyOptimism"
  LINKEXTRA=( -pthread -sPTHREAD_POOL_SIZE=33 -sINITIAL_MEMORY=512MB )
fi

mapfile -t SRCS < <(cat "${MANIFESTS[@]}" | grep -vE '^\s*(#|$)')
echo "==> $OUTNAME: ${#SRCS[@]} sources from ${MANIFESTS[*]}"

OBJS=()
for f in "${SRCS[@]}"; do
  extra=()
  std=c++17
  if [ "$f" = "kataeval/backend_gpu.cpp" ]; then
    std=c++20
  elif [ "$f" = "kataeval/backend_cpu.cpp" ]; then
    extra=( -DUSE_EIGEN_BACKEND -isystem /usr/include/eigen3 )
  fi
  o="$OBJ/$(echo "$f" | tr '/.' '__').o"
  em++ -c "$f" -std=$std "${CFLAGS[@]}" "${extra[@]}" -o "$o"
  OBJS+=("$o")
done

echo "==> linking -> web/demo/$OUTNAME.js"
em++ "${OBJS[@]}" --use-port=emdawnwebgpu -sUSE_ZLIB=1 \
  -fexceptions \
  -sASYNCIFY -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 \
  -sSTACK_SIZE=16MB "${LINKEXTRA[@]}" \
  -sMODULARIZE=1 -sEXPORT_NAME=createKata \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS,HEAPF32,HEAP32,UTF8ToString \
  -O2 -o "$ROOT/web/demo/$OUTNAME.js"

echo "==> built:"; ls -la "$ROOT/web/demo/$OUTNAME.js" "$ROOT/web/demo/$OUTNAME.wasm"
exit 0