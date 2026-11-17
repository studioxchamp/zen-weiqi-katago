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
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
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
const results = { startedAt: new Date().toISOString(), checks: {}, errors: [] };

try {
  const enginePage = await browser.newPage();
  enginePage.on('pageerror', (e) => results.errors.push(`worker test pageerror: ${e.message}`));
  await enginePage.goto(origin, { waitUntil: 'domcontentloaded' });
  const workerResult = await enginePage.evaluate(async () => {
    if (!crossOriginIsolated || typeof SharedArrayBuffer !== 'function') throw new Error('COOP/COEP isolation unavailable');
    const model = await fetch('/katago/model-b10c128.bin.gz', { method: 'HEAD' });
    if (!model.ok) throw new Error(`model HTTP ${model.status}`);
    const [wasmResponse, jsResponse] = await Promise.all([fetch('/katago/kataeval-mt.wasm'), fetch('/katago/kataeval-mt.js')]);
    if (!wasmResponse.ok || !jsResponse.ok) throw new Error(`engine assets HTTP ${wasmResponse.status}/${jsResponse.status}`);
    const wasmBinary = await wasmResponse.arrayBuffer();
    const jsText = await jsResponse.text();
    if (!jsText.includes('mainScriptUrlOrBlob')) throw new Error('generated JS does not expose mainScriptUrlOrBlob');
    const worker = new Worker('/katago/kata-worker.js');
    const diagnostics = [];
    const pending = new Map();
    let progressListener = null;
    let progressReject = null;
    worker.onmessage = ({ data }) => {
      if (data.diag) diagnostics.push(data.diag);
      if (data.progress && progressListener) { const fn = progressListener; progressListener = null; progressReject = null; fn(data); }
      if (data.id && pending.has(data.id)) {
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
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`worker request ${id} timed out`)); }, 180000);
      pending.set(id, { resolve, reject, timer }); worker.postMessage({ id, ...msg }, transfer);
    });
    try {
      const init = await send(1, { type: 'init', netFile: 'model-b10c128.bin.gz', boardSize: 19, wasmBinary, jsText, forceCpu: true, fp16: false, optimism: 0 }, [wasmBinary]);
      if (!diagnostics.includes('createKata: runtime + thread pool ready')) throw new Error('Emscripten thread pool did not report ready');
      const evaluated = await send(2, { type: 'eval', moves: [], toPlay: 1, komi: 6.5, owner: false });
      if (evaluated.policy.length !== 362 || evaluated.value.length !== 5 || !Array.from(evaluated.value).every(Number.isFinite)) throw new Error('invalid kgeEvalSeqKata output');
      const searched = await send(3, { type: 'search', moves: [], toPlay: 1, komi: 6.5, visits: 24, ms: 1500, threads: 2, noPonder: true });
      if (!Number.isInteger(searched.best) || searched.best < -1 || searched.best >= 361 || searched.nv < 1) throw new Error('search did not return a legal board point/pass');

      const started = new Promise((resolve, reject) => { progressListener = resolve; progressReject = reject; });
      const longSearch = send(4, { type: 'search', moves: [], toPlay: 1, komi: 6.5, visits: 500000, ms: 120000, threads: 2, noPonder: true });
      const progress = await started;
      if (progress.done) throw new Error('search completed before cancel could be exercised');
      const cancelledSearch = send(5, { type: 'cancel' });
      const [searchEnd, cancelAck] = await Promise.all([longSearch, cancelledSearch]);
      if (!searchEnd.superseded || !cancelAck.ok) throw new Error('cancel did not supersede the active search');
      return { backend: init.backend, modelVersion: init.version, modelHttpStatus: model.status, wasmBytes: wasmBinary.byteLength, diagnostics, evalPolicyLength: evaluated.policy.length, evalValue: Array.from(evaluated.value), best: searched.best, visits: searched.nv, cancelSuperseded: searchEnd.superseded };
    } finally { worker.terminate(); }
  });
  results.checks.engineWorker = workerResult;
  await enginePage.close();

  const gamePage = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
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
  results.checks.game = { engineStatus: gameStatus.trim(), moveHistory: moveHistory.trim() };
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
  await browser.close();
  await new Promise((ok) => server.close(ok));
}
