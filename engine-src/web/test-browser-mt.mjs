// End-to-end verification of the exact Netlify site assets in a real browser.
// Requires: npm install --no-save playwright && npx playwright install chromium
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../..');
const siteRoot = resolve(packageRoot, 'site');
const reportFile = resolve(packageRoot, '.validation/kata-mt-browser.json');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.gz': 'application/gzip' };

const server = createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Match the production Netlify site/_headers policy so external CDN assets
  // behave the same in Chromium validation as they do on the deployed site.
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(siteRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
    assert(file === siteRoot || file.startsWith(siteRoot + sep), 'path escaped site directory');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
const cdp = await browser.newBrowserCDPSession();
const workerTargets = [];
cdp.on('Target.targetCreated', ({ targetInfo }) => {
  if (targetInfo.type === 'worker') workerTargets.push({ url: targetInfo.url, title: targetInfo.title });
});
await cdp.send('Target.setDiscoverTargets', { discover: true });
const results = { startedAt: new Date().toISOString(), checks: {}, errors: [] };

try {
  const enginePage = await browser.newPage();
  enginePage.on('pageerror', (e) => results.errors.push(`worker test pageerror: ${e.message}`));
  await enginePage.goto(origin, { waitUntil: 'domcontentloaded' });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const workerBaseline = workerTargets.length;
  const workerResult = await enginePage.evaluate(async () => {
    if (!crossOriginIsolated || typeof SharedArrayBuffer !== 'function') throw new Error('COOP/COEP isolation unavailable');
    const model = await fetch('/katago/model-b10c128.bin.gz', { method: 'HEAD' });
    if (!model.ok) throw new Error(`model HTTP ${model.status}`);
    const [wasmResponse, jsResponse] = await Promise.all([fetch('/katago/kataeval-mt.wasm'), fetch('/katago/kataeval-mt.js')]);
    if (!wasmResponse.ok || !jsResponse.ok) throw new Error(`engine assets HTTP ${wasmResponse.status}/${jsResponse.status}`);
    const wasmBinary = await wasmResponse.arrayBuffer();
    const jsText = await jsResponse.text();
    const diagByRequest = new Map();
    const worker = new Worker('/katago/kata-worker.js');
    const diagnostics = [];
    const unmatchedResponses = [];
    const pending = new Map();
    let progressListener = null;
    let progressReject = null;
    worker.onmessage = ({ data }) => {
      if (data.diag) {
        diagnostics.push({ requestId: data.requestId ?? null, message: data.diag, at: performance.now() });
        if (data.requestId != null) diagByRequest.set(data.requestId, data.diag);
      }
      if (data.progress && progressListener) { const fn = progressListener; progressListener = null; progressReject = null; fn(data); }
      if (data.id != null) {
        if (!pending.has(data.id)) {
          unmatchedResponses.push({ id: data.id, ok: data.ok, error: data.error || null });
          return;
        }
        const { resolve, reject, timer } = pending.get(data.id);
        clearTimeout(timer); pending.delete(data.id);
        data.ok ? resolve(data) : reject(new Error(data.error || `worker request ${data.id} failed`));
      }
    };
    worker.onerror = (e) => {
      const error = new Error(`worker error: ${e.message}`);
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
      pending.clear();
      if (progressReject) progressReject(error);
    };
    const send = (id, msg, transfer = []) => new Promise((resolve, reject) => {
      // The worker has separate 120s runtime, 70s model, 120s kgeLoad and
      // 90s eval guards. Keep the outer init deadline above their combined
      // maximum so a staged worker diagnostic wins over a generic timeout.
      const timeoutMs = ({ init: 320000, eval: 95000, search: 155000, cancel: 30000, strength: 15000 })[msg.type] || 30000;
      const timer = setTimeout(() => {
        pending.delete(id);
        const lastStage = diagByRequest.get(id) || 'no worker diagnostic received';
        reject(new Error(`worker request ${id} (${msg.type}) timed out after ${timeoutMs} ms; last worker stage: ${lastStage}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer }); worker.postMessage({ id, ...msg }, transfer);
    });
    try {
      const init = await send(1, { type: 'init', netFile: 'model-b10c128.bin.gz', boardSize: 19, wasmBinary, jsText, forceCpu: false, fp16: false, optimism: 0 }, [wasmBinary]);
      if (init.id !== 1) throw new Error(`init response ID mismatch: expected 1, received ${init.id}`);
      const initDiags = diagnostics.filter((d) => d.requestId === 1).map((d) => d.message);
      for (const stage of ['init: Emscripten runtime and pthread pool ready', 'model: ', 'kgeLoad: complete;']) {
        if (!initDiags.some((d) => d.includes(stage))) throw new Error(`init response arrived without diagnostic stage: ${stage}; saw ${JSON.stringify(initDiags)}`);
      }
      if (!initDiags.some((d) => d.startsWith('model: downloaded ') || d.startsWith('model: cache hit ('))) {
        throw new Error(`model was not confirmed downloaded or loaded from cache: ${JSON.stringify(initDiags)}`);
      }
      const evaluated = await send(2, { type: 'eval', moves: [], toPlay: 1, komi: 6.5, owner: false });
      if (evaluated.id !== 2) throw new Error(`eval response ID mismatch: expected 2, received ${evaluated.id}`);
      if (evaluated.policy.length !== 362 || evaluated.value.length !== 5 || !Array.from(evaluated.value).every(Number.isFinite)) throw new Error('invalid kgeEvalSeqKata output');
      const searched = await send(3, { type: 'search', moves: [], toPlay: 1, komi: 6.5, visits: 24, ms: 1500, threads: 2, noPonder: true });
      if (searched.id !== 3) throw new Error(`search response ID mismatch: expected 3, received ${searched.id}`);
      if (!Number.isInteger(searched.best) || searched.best < -1 || searched.best >= 361 || searched.nv < 1) throw new Error('search did not return a legal board point/pass');

      const started = new Promise((resolve, reject) => { progressListener = resolve; progressReject = reject; });
      const longSearch = send(4, { type: 'search', moves: [], toPlay: 1, komi: 6.5, visits: 500000, ms: 120000, threads: 2, noPonder: true });
      const progress = await started;
      if (progress.done) throw new Error('search completed before cancel could be exercised');
      const cancelledSearch = send(5, { type: 'cancel' });
      const [searchEnd, cancelAck] = await Promise.all([longSearch, cancelledSearch]);
      if (searchEnd.id !== 4 || cancelAck.id !== 5) throw new Error(`search/cancel response ID mismatch: ${searchEnd.id}/${cancelAck.id}`);
      if (!searchEnd.superseded || !cancelAck.ok) throw new Error('cancel did not supersede the active search');
      const searchedAfterCancel = await send(6, { type: 'search', moves: [{ loc: 9 * 19 + 9, col: 1 }], toPlay: 2, komi: 6.5, visits: 24, ms: 1500, threads: 2, noPonder: true });
      if (searchedAfterCancel.id !== 6) throw new Error(`post-cancel search response ID mismatch: expected 6, received ${searchedAfterCancel.id}`);
      if (!Number.isInteger(searchedAfterCancel.best) || searchedAfterCancel.best < -1 || searchedAfterCancel.best >= 361 || searchedAfterCancel.nv < 1) throw new Error('post-cancel search did not return a legal board point/pass');
      worker.terminate();
      const evalDiags = diagnostics.filter((d) => d.requestId === 2).map((d) => d.message);
      if (!evalDiags.some((d) => d.includes('eval: kgeEvalSeqKata complete'))) throw new Error(`eval response arrived without completion diagnostic: ${JSON.stringify(evalDiags)}`);
      if (unmatchedResponses.length) throw new Error(`worker sent response IDs with no matching request: ${JSON.stringify(unmatchedResponses)}`);
      return { backend: init.backend, modelVersion: init.version, modelHttpStatus: model.status, wasmBytes: wasmBinary.byteLength, diagnostics, threadPoolReady: true, responseIds: [init.id, evaluated.id, searched.id, searchEnd.id, cancelAck.id, searchedAfterCancel.id], evalPolicyLength: evaluated.policy.length, evalValue: Array.from(evaluated.value), best: searched.best, visits: searched.nv, cancelSuperseded: searchEnd.superseded, postCancelBest: searchedAfterCancel.best, postCancelVisits: searchedAfterCancel.nv };
    } catch (error) {
      worker.terminate();
      throw error;
    }
  });
  const tf3Availability = await enginePage.evaluate(async () => {
    const url = 'https://github.com/studioxchamp/zen-weiqi-katago/releases/download/kata1-tf3-b11c768-s12382M-d6533M/model-tf3-b11c768.bin.gz';
    try {
      const response = await fetch(url, { method: 'HEAD', mode: 'cors' });
      return {
        url,
        headStatus: response.status,
        ok: response.ok,
        contentLength: response.headers.get('content-length'),
        note: response.ok ? 'Remote TF3 URL is reachable with browser CORS' : 'Remote TF3 server returned a non-success status; application should fall back to B10C128'
      };
    } catch (error) {
      return { url, ok: false, error: String(error), note: 'Browser CORS/network preflight failed; application should fall back to B10C128' };
    }
  });
  results.checks.tf3RemoteAsset = tf3Availability;

  const workerWaitDeadline = Date.now() + 10000;
  while (workerTargets.length < workerBaseline + 10 && Date.now() < workerWaitDeadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  const spawnedTargets = workerTargets.slice(workerBaseline);
  // Some Chromium/Playwright combinations emit Target.targetCreated events with
  // empty targetInfo.url/title for workers, even though the workers are running.
  // The end-to-end worker test above has already required successful runtime init,
  // model load, eval, search, and cancellation. In that case, verify the observed
  // worker target count (1 outer worker + 9 prewarmed pthread workers) instead of
  // failing on unavailable metadata. When URLs are exposed, retain strict checks.
  const targetsWithUrls = spawnedTargets.filter((target) => target.url);
  const outerWorker = targetsWithUrls.find((target) => target.url.includes('/katago/kata-worker.js'));
  if (spawnedTargets.length < 10) {
    throw new Error(`expected at least 10 worker targets (outer worker + 9 Emscripten pthread workers); observed ${spawnedTargets.length}: ${JSON.stringify(spawnedTargets)}`);
  }
  if (targetsWithUrls.length > 0) {
    if (!outerWorker) throw new Error(`main KataGo worker target URL not observed among URL-bearing targets: ${JSON.stringify(targetsWithUrls)}`);
    const pthreadTargets = targetsWithUrls.filter((target) => target !== outerWorker);
    if (pthreadTargets.length < 9) throw new Error(`expected 9 URL-bearing Emscripten pthread workers; observed ${pthreadTargets.length}: ${JSON.stringify(targetsWithUrls)}`);
    const wrongBootstrap = pthreadTargets.filter((target) => target.url.includes('/katago/kata-worker.js'));
    if (wrongBootstrap.length) throw new Error(`pthread workers reloaded kata-worker.js instead of the Emscripten module: ${JSON.stringify(wrongBootstrap)}`);
    const unknownBootstrap = pthreadTargets.filter((target) => !target.url.startsWith('blob:') && !target.url.includes('/katago/kataeval-mt.js'));
    if (unknownBootstrap.length) throw new Error(`pthread workers used an unexpected bootstrap URL: ${JSON.stringify(unknownBootstrap)}`);
    workerResult.threadWorkers = pthreadTargets.map((target) => target.url);
  } else {
    workerResult.threadTargetMetadata = 'Chromium CDP returned empty URLs; validated by observed target count';
  }
  workerResult.workerTargetCount = spawnedTargets.length;
  results.checks.engineWorker = workerResult;
  await enginePage.close();

  const gamePage = await browser.newPage({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  gamePage.on('pageerror', (e) => results.errors.push(`game pageerror: ${e.message}`));
  gamePage.on('console', (msg) => { if (msg.type() === 'error') results.errors.push(`game console: ${msg.text()}`); });
  await gamePage.goto(origin, { waitUntil: 'networkidle' });
  assert.equal(await gamePage.evaluate(() => crossOriginIsolated), true, 'game page must be cross-origin isolated');
  await gamePage.locator('#btnOverlayOpenSettings').click();
  await gamePage.locator('.color-choice-btn[data-color="2"]').click();
  await gamePage.locator('#modalRankSelect').selectOption('8k');
  await gamePage.locator('#btnStartNewGame').click();
  await gamePage.locator('#btnOverlayStartGame').click();
  await gamePage.waitForFunction(() => {
    const status = document.querySelector('#kataGoEngineStatus')?.textContent || '';
    const history = document.querySelector('#moveHistoryBox')?.textContent || '';
    return /พร้อม\s*[·・]/.test(status) && history.trim() !== 'ยังไม่มีการวางหมาก...';
  }, { timeout: 180000 });
  const gameStatus = await gamePage.locator('#kataGoEngineStatus').textContent();
  const moveHistory = await gamePage.locator('#moveHistoryBox').innerText();
  assert(!/ใช้ AI สำรอง|ไม่พร้อม|ขัดข้อง/.test(gameStatus), `page fell back instead of using KataGo: ${gameStatus}`);
  assert(moveHistory.trim() !== 'ยังไม่มีการวางหมาก...', 'AI move was not recorded in the game');

  // Finish the game and verify the replay timeline + portable SGF download.
  await gamePage.locator('#btnResign').click();
  await gamePage.locator('#btnConfirmResign').click();
  await gamePage.waitForFunction(() => {
    const el = document.querySelector('#postGameReviewActions');
    return !!el && !el.classList.contains('hidden');
  }, { timeout: 10000 });

  const downloadPromise = gamePage.waitForEvent('download', { timeout: 60000 });
  await gamePage.locator('#btnExportSgfFromResult').click();
  const sgfDownload = await downloadPromise;
  const sgfPath = await sgfDownload.path();
  assert(sgfPath, 'SGF download did not produce a local file');
  const sgfText = await readFile(sgfPath, 'utf8');
  assert(sgfText.startsWith('(;GM[1]FF[4]'), 'exported SGF root metadata is missing');
  assert(sgfText.includes('PB[') && sgfText.includes('PW['), 'exported SGF player names are missing');
  assert(sgfText.includes(';B[') || sgfText.includes(';W['), 'exported SGF contains no move nodes');

  await gamePage.locator('#btnReviewFromScore').click();
  assert(await gamePage.locator('#scoreModal').evaluate(el => el.classList.contains('hidden')), 'result dialog did not close when opening review');
  await gamePage.waitForFunction(() => {
    const el = document.querySelector('#reviewControls');
    return !!el && !el.classList.contains('hidden');
  }, { timeout: 10000 });
  const maxReviewMove = Number(await gamePage.locator('#reviewMoveSlider').getAttribute('max'));
  assert(maxReviewMove >= 1, `review timeline should contain at least one move, got max=${maxReviewMove}`);
  await gamePage.locator('#btnReviewLast').click();
  assert((await gamePage.locator('#reviewMoveLabel').textContent()).includes(`/${maxReviewMove}`), 'review did not reach the final move');
  await gamePage.locator('#btnReviewFirst').click();
  assert((await gamePage.locator('#reviewMoveLabel').textContent()).includes('ตา 0'), 'review did not return to the initial board');
  await gamePage.locator('#btnCloseReview').click();
  assert(await gamePage.locator('#postGameReviewActions').isVisible(), 'post-game review actions did not return after closing review');

  results.checks.game = {
    engineStatus: gameStatus.trim(),
    moveHistory: moveHistory.trim(),
    sgfDownload: sgfDownload.suggestedFilename(),
    sgfHasMoves: true,
    reviewFrameCount: maxReviewMove + 1,
    reviewReachedInitialAndFinal: true
  };
  assert.deepEqual(results.errors, [], results.errors.join('\n'));
  results.finishedAt = new Date().toISOString();
  results.outcome = 'PASS';
  await mkdir(dirname(reportFile), { recursive: true });
  await writeFile(reportFile, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  results.finishedAt = new Date().toISOString();
  results.outcome = 'FAIL';
  results.failure = String(error?.stack || error);
  await mkdir(dirname(reportFile), { recursive: true });
  await writeFile(reportFile, JSON.stringify(results, null, 2) + '\n');
  console.error(JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await cdp.detach();
  await browser.close();
  await new Promise((ok) => server.close(ok));
}
