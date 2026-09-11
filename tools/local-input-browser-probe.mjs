// Real keyboard -> RaceCanvas -> module Worker -> fixed-step input; offline only.
import { createServer, build } from 'vite'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const { chromium } = await import(pathToFileURL(resolve('../never-lift-backend/tools/physics-parity/node_modules/playwright/index.mjs')).href)
const bundle = await build({ configFile: false, logLevel: 'error', resolve: { alias: { '@': resolve('src') } },
  build: { ssr: true, write: false, minify: false, rolldownOptions: { input: resolve('tools/local-input-probe.worker.ts') } } })
const workerCode = bundle.output.find(item => item.type === 'chunk' && item.isEntry).code
const track = JSON.parse(await readFile('../never-lift-backend/contracts/module-2/v2/tracks/spa-francorchamps.json', 'utf8'))
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, ws: false } })
await server.listen()
const origin = server.resolvedUrls.local[0]
const browser = await chromium.launch({ channel: process.env.PROBE_BROWSER ?? 'msedge', headless: true })
const results = []
try {
  for (const [mode, cars] of [['solo', 1], ['local', 2], ['solo', 22], ['local', 22]]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    const html = await server.transformIndexHtml('/__input-probe', '<!doctype html><div id="root"></div><script type="module" src="/tools/local-input-probe-entry.tsx"></script>')
    await page.route('**/__input-probe?**', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.route('**/__input-probe-worker.js', route => route.fulfill({ contentType: 'text/javascript', body: workerCode }))
    await page.addInitScript(track => { window.probeTrack = track }, track)
    await page.goto(`${origin}__input-probe?mode=${mode}&cars=${cars}`)
    await page.waitForFunction(() => window.probe?.simulationTime > 0.1, null, { timeout: 25000 })
    const repetitions = 20
    // No artificial delay between down/up: regression for taps shorter than RAF.
    for (let i = 0; i < repetitions; i++) {
      await page.keyboard.press(i % 2 ? 'ArrowRight' : 'ArrowLeft')
      if (mode === 'local') await page.keyboard.press(i % 2 ? 'd' : 'a')
      await page.waitForTimeout(65)
    }
    await page.waitForTimeout(250)
    const data = await page.evaluate(() => window.probe)
    await mkdir('output/performance', { recursive: true })
    await writeFile(`output/performance/input-probe-${mode}-${cars}.json`, JSON.stringify(data, null, 2))
    const drivers = mode === 'local' ? ['player-1', 'player-2'] : ['player-1']
    const latencyMs = []
    const dispatchDelayMs = []
    for (const id of drivers) {
      const keys = data.keys.filter(e => e.type === 'keydown' && (id === 'player-1' ? e.code.startsWith('Arrow') : ['KeyA', 'KeyD'].includes(e.code)))
      const applied = data.observed.filter(e => e.id === id && e.input.steer !== 0)
      const sent = data.sent.filter(e => e.inputs[id]?.steer)
      assert.equal(keys.length, repetitions)
      assert.equal(applied.length, repetitions, `${mode}/${cars}/${id}: lost tap`)
      for (let i = 0; i < repetitions; i++) {
        // Reverse adaptation remains part of the existing keyboard policy.
        // Compare the actual adapted command, not an assumed forward direction.
        assert.deepEqual(applied[i].input, sent[i].inputs[id])
        latencyMs.push(applied[i].timestamp - keys[i].timestamp)
        dispatchDelayMs.push(keys[i].receivedTimestamp - keys[i].timestamp)
      }
      assert.equal(data.observed.filter(e => e.id === id).at(-1).input.steer, 0, 'release must not stick')
    }
    const combinedStart = await page.evaluate(() => window.probe.observed.length)
    await page.keyboard.down('ArrowUp')
    if (mode === 'local') await page.keyboard.down('w')
    await page.waitForTimeout(500)
    await page.keyboard.press('ArrowLeft')
    if (mode === 'local') await page.keyboard.press('a')
    await page.waitForTimeout(150)
    await page.keyboard.up('ArrowUp')
    if (mode === 'local') await page.keyboard.up('w')
    await page.keyboard.down('ArrowDown')
    if (mode === 'local') await page.keyboard.down('s')
    await page.keyboard.press('ArrowRight')
    if (mode === 'local') await page.keyboard.press('d')
    await page.waitForTimeout(150)
    await page.keyboard.up('ArrowDown')
    if (mode === 'local') await page.keyboard.up('s')
    await page.waitForTimeout(150)
    const combined = await page.evaluate(start => window.probe.observed.slice(start), combinedStart)
    for (const id of drivers) {
      const states = combined.filter(e => e.id === id).map(e => e.input)
      assert.ok(states.some(input => input.throttle === 1 && input.steer !== 0), `${id}: throttle + steer`)
      assert.ok(states.some(input => input.brake === 1 && input.steer !== 0), `${id}: brake + steer`)
      assert.deepEqual(states.at(-1), { throttle: 0, brake: 0, steer: 0 }, `${id}: complete release`)
    }
    assert.deepEqual(errors, [])
    latencyMs.sort((a,b) => a-b)
    results.push({ mode, cars, taps: repetitions * drivers.length, lost: 0, latencyMs: {
      mean: latencyMs.reduce((a,b)=>a+b,0) / latencyMs.length,
      p95: latencyMs[Math.floor(latencyMs.length * 0.95)], max: Math.max(...latencyMs),
    }, combinedInputs: 'throttle+steer, brake+steer, full release passed for every human',
      maximumBrowserDispatchDelayMs: Math.max(...dispatchDelayMs), snapshots: data.snapshots, errors })
    console.log(JSON.stringify(results.at(-1)))
    await page.close()
  }
  await mkdir('output/performance', { recursive: true })
  await writeFile(process.env.INPUT_PROBE_REPORT ?? 'output/performance/input-browser-probe.json', JSON.stringify({ browser: await browser.version(), results }, null, 2))
} finally { await browser.close(); await server.close() }
