// Real Vite + React + module Worker lifecycle smoke, no external API/deploy.
import { createServer } from 'vite'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const { chromium } = await import(pathToFileURL(resolve('../never-lift-backend/tools/physics-parity/node_modules/playwright/index.mjs')).href)
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, ws: false } })
await server.listen()
const origin = server.resolvedUrls.local[0]
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
  const html = await server.transformIndexHtml('/__worker-smoke', '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/tools/local-worker-smoke-entry.tsx"></script></body></html>')
  await page.route('**/__worker-smoke', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(origin + '__worker-smoke')
  await page.waitForFunction(() => window.smoke?.last?.simulationTimeSeconds > 0.2, null, { timeout: 20000 }).catch(async error => {
    console.error(JSON.stringify({ errors, state: await page.evaluate(() => ({ smoke: window.smoke, text: document.body.innerText.slice(0, 600) })) }))
    throw error
  })
  await page.keyboard.down('w')
  await page.keyboard.down('ArrowUp')
  await page.waitForFunction(() => window.smoke.last.vehicles.every(vehicle => Math.hypot(vehicle.velocity.x, vehicle.velocity.y) > 1))
  await page.keyboard.up('w')
  await page.keyboard.up('ArrowUp')
  await mkdir('output/performance', { recursive: true })
  await page.screenshot({ path: 'output/performance/worker-react-local.png' })
  await page.keyboard.press('r')
  await page.waitForFunction(() => window.smoke.started >= 3 && window.smoke.last.simulationTimeSeconds === 0)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.smoke.aborted === 1 && window.smoke.stopped === window.smoke.started)
  await page.evaluate(() => window.smokeFinish())
  await page.waitForFunction(() => window.smoke.finished === 1 && window.smoke.stopped === window.smoke.started, null, { timeout: 20000 })
  const lifecycle = await page.evaluate(() => ({ ...window.smoke, last: undefined }))
  assert.equal(errors.length, 0, errors.join('\n'))
  // Also execute the actual production worker asset, not just Vite's dev worker.
  const assets = await readdir('dist/assets')
  const workerAsset = assets.find(name => /^local-race\.worker-.*\.js$/.test(name))
  assert.ok(workerAsset, 'Run npm run build before this smoke')
  const code = await readFile(resolve('dist/assets', workerAsset), 'utf8')
  await page.route('**/__built-worker.js', route => route.fulfill({ contentType: 'text/javascript', body: code }))
  const builtWorker = await page.evaluate(async () => {
    const { SHORT_TRACK } = await import('/src/test/track-fixtures.ts')
    return new Promise((resolve, reject) => {
      const worker = new Worker('/__built-worker.js', { type: 'module' })
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Built worker timeout')) }, 15000)
      worker.onerror = () => { clearTimeout(timeout); worker.terminate(); reject(new Error('Built worker error')) }
      worker.onmessage = ({ data }) => {
        if (data.type === 'failure') { clearTimeout(timeout); worker.terminate(); reject(new Error(data.message)); return }
        if (data.simulationTimeSeconds > 0.1) {
          clearTimeout(timeout); worker.terminate(); resolve({ type: data.type, cars: data.vehicles.length }); return
        }
        worker.postMessage({ type: 'frame' })
      }
      worker.postMessage({ type: 'init', humanIds: ['player-1'], options: {
        track: SHORT_TRACK, mode: 'solo', racers: [{ id: 'player-1', name: 'P1', kind: 'human', color: '#2d7dff' }],
      } })
    })
  })
  console.log(JSON.stringify({ passed: true, lifecycle, builtWorker, errors }))
} finally { await browser.close(); await server.close() }
