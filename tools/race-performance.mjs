// Reproducible CPU probe, not a hardware-sensitive CI pass/fail assertion.
// --baseline loads committed race sources through Vite without touching the checkout.
import { execFileSync } from 'node:child_process'
import { deepStrictEqual } from 'node:assert'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

const root = process.cwd()
const baseline = process.argv.includes('--baseline')
const workerMode = process.argv.includes('--worker')
if (workerMode && (baseline || !process.argv.includes('--browser') || !process.argv.includes('--fixed-driving'))) {
  throw new Error('--worker requires --browser --fixed-driving and cannot use --baseline')
}
const baselineRef = process.env.PERF_BASE_REF ?? 'HEAD'
const bundle = await build({
  configFile: false,
  resolve: { alias: { '@': resolve(root, 'src') } },
  logLevel: 'error',
  build: { ssr: true, write: false, minify: false, rolldownOptions: { input: resolve(root, workerMode ? 'tools/race-worker-performance-entry.ts' : 'tools/race-performance-entry.ts') } },
  plugins: baseline ? [{
    name: 'committed-race-baseline',
    enforce: 'pre',
    load(id) {
      const prefix = root.replaceAll('\\', '/') + '/src/race/'
      if (!id.replaceAll('\\', '/').startsWith(prefix) || !id.endsWith('.ts')) return
      return execFileSync('git', ['show', baselineRef + ':src/race/' + id.slice(prefix.length)], { cwd: root, encoding: 'utf8' })
    },
  }] : [],
})
{
  const code = bundle.output.find(item => item.type === 'chunk' && item.isEntry).code
  const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  const { RaceEngine, TrackGeometry, performanceRacers } = await import(moduleUrl)
  if (process.argv.includes('--ccd-samples')) {
    const { sweepCompoundCollidersWithRotation, createVehicleWorldCollider } = await import(moduleUrl)
    let seed = 92753
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    const outputs = []
    for (let index = 0; index < 512; index++) {
      const firstPosition = { x: 400, y: -250 }
      const secondPosition = { x: 400 + random() * 10 - 5, y: -250 + random() * 10 - 5 }
      const first = { position: firstPosition, colliders: createVehicleWorldCollider({ position: firstPosition, angle: random() * Math.PI * 2 }), velocity: { x: random() * 160 - 80, y: random() * 160 - 80 }, angularVelocity: random() * 60 - 30 }
      const second = { position: secondPosition, colliders: createVehicleWorldCollider({ position: secondPosition, angle: random() * Math.PI * 2 }), velocity: { x: random() * 160 - 80, y: random() * 160 - 80 }, angularVelocity: random() * 60 - 30 }
      outputs.push(sweepCompoundCollidersWithRotation(first, second, index % 2 === 0 ? 1 / 120 : 1 / 30))
    }
    console.log(JSON.stringify({ baseline, samples: outputs.length, contacts: outputs.filter(Boolean).length, sha256: createHash('sha256').update(JSON.stringify(outputs)).digest('hex') }))
    if (process.argv.includes('--state')) console.log(JSON.stringify(outputs))
    process.exit(0)
  }
  const trackId = process.env.PERF_TRACK ?? 'albert-park'
  const catalogRoot = resolve(process.env.PERF_CATALOG_ROOT ?? '../never-lift-backend/contracts/module-2/v2/tracks')
  if (process.argv.includes('--geometry-parity')) {
    // Compare to the already-frozen oracle. Never regenerate expected outputs
    // merely because a source hash changed during an equivalent optimization.
    const reference = JSON.parse(await readFile(resolve(process.env.PERF_GEOMETRY_REFERENCE ?? '../never-lift-backend/src/test/resources/physics/typescript-geometry-2.0.3.json'), 'utf8'))
    let samples = 0
    for (const expectedTrack of reference.tracks) {
      const definition = JSON.parse(await readFile(resolve(catalogRoot, `${expectedTrack.id}.json`), 'utf8'))
      const geometry = new TrackGeometry(definition)
      const engine = new RaceEngine({ track: definition, mode: 'solo', racers: [{ id: 'bot-reference', name: 'Bot', kind: 'bot', color: '#365f82' }] })
      for (const sample of expectedTrack.samples) {
        const projection = geometry.project(sample.position, sample.distance)
        const surface = geometry.getSurfaceAt(sample.position, sample.distance)
        const barriers = geometry.getBarrierColliders(projection.elevationLayer, sample.bounds)
        const car = engine.getVehicleState('bot-reference')
        Object.assign(car, { position: sample.position, trackDistanceMeters: sample.distance, angle: sample.angle, velocity: sample.velocity, surface })
        engine.simulationTimeSeconds = 2
        const inputs = {}
        for (const difficulty of ['easy', 'normal', 'hard']) {
          car.botDifficulty = difficulty
          inputs[difficulty] = engine.createBotInput(car)
        }
        deepStrictEqual({ projection, surface, barriers, inputs }, {
          projection: sample.projection, surface: sample.surface, barriers: sample.barriers, inputs: sample.inputs,
        }, `${expectedTrack.id} at ${sample.distance}m`)
        samples++
      }
    }
    console.log(JSON.stringify({ passed: true, circuits: reference.tracks.length, samples }))
    process.exit(0)
  }
  const track = JSON.parse(await readFile(resolve(catalogRoot, `${trackId}.json`), 'utf8'))
  let workerCode = null
  if (workerMode) {
    const workerBundle = await build({ configFile: false, logLevel: 'error', resolve: { alias: { '@': resolve(root, 'src') } },
      build: { ssr: true, write: false, minify: false, rolldownOptions: { input: resolve(root, 'tools/race-worker-benchmark.ts') } } })
    workerCode = workerBundle.output.find(item => item.type === 'chunk' && item.isEntry).code
  }
  if (process.argv.includes('--browser')) {
    const playwrightPath = resolve(process.env.PERF_PLAYWRIGHT_MODULE ?? '../never-lift-backend/tools/physics-parity/node_modules/playwright/index.mjs')
    const { chromium } = await import(pathToFileURL(playwrightPath).href)
    const browser = await chromium.launch({ headless: true, channel: process.env.PERF_BROWSER ?? 'msedge' })
    try {
      for (const mode of (process.env.PERF_MODES ?? 'solo,local').split(',')) {
        const page = await browser.newPage({ viewport: { width: Number(process.env.PERF_WIDTH ?? 1920), height: Number(process.env.PERF_HEIGHT ?? 1080) }, deviceScaleFactor: Number(process.env.PERF_DPR ?? 1) })
        page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
        page.on('pageerror', error => console.error(error.message))
        if (workerMode) {
          // Give module workers an actual origin; blob:null workers are rejected
          // by Edge in an about:blank page. This is entirely intercepted locally.
          await page.route('http://race-benchmark.local/**', route => route.fulfill({
            contentType: 'text/html', body: '<!doctype html><html><body></body></html>',
          }))
          await page.goto('http://race-benchmark.local/')
        }
        await page.setContent('<style>html,body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas>')
        const profiler = process.argv.includes('--profile') ? await page.context().newCDPSession(page) : null
        if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start') }
        const result = await page.evaluate(async ({ moduleUrl, workerCode, track, mode, driving, fixedDriving, frames, maximumSeconds, cars, timeOfDay, opaqueCanvas, desynchronized, diagnosticNoShadowBlur, disableVehicleSprites }) => {
          const { RaceEngine, RaceRenderer, LocalRaceRuntime, raceGraphicsSettings, performanceRacers } = await import(moduleUrl)
          const count = cars ?? (mode === 'solo' ? 22 : 2)
          const racers = performanceRacers(mode, count)
          const engine = new RaceEngine({ track, mode, racers })
          const humanIds = racers.filter(racer => racer.kind === 'human').map(racer => racer.id)
          const driveHumans = () => {
            for (const id of humanIds) engine.setInput(id, engine.createBotInput(engine.getVehicleState(id)))
          }
          if (fixedDriving) {
            const step = engine.stepFixed.bind(engine)
            engine.stepFixed = () => { driveHumans(); step() }
          }
          const workerUrl = workerCode ? URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' })) : null
          const runtime = workerUrl ? new LocalRaceRuntime(engine, humanIds, () => new Worker(workerUrl, { type: 'module' })) : null
          const view = runtime ?? engine
          if (runtime) {
            const deadline = performance.now() + 15000
            while (runtime.getSimulationTimeSeconds() === 0) {
              await new Promise(resolve => requestAnimationFrame(resolve))
              runtime.advanceFrame(0, {})
              if (runtime.getFailure() || !runtime.getDiagnostics().worker || performance.now() > deadline) throw new Error(runtime.getFailure() ?? runtime.getDiagnostics().diagnosticError ?? 'Worker did not start')
            }
            if (!runtime.getDiagnostics().worker) throw new Error('Worker silently fell back')
          }
          if (opaqueCanvas || desynchronized) document.querySelector('canvas').getContext('2d', { alpha: !opaqueCanvas, desynchronized })
          // Diagnostic ablation ONLY; never used by the shipped app or acceptance results.
          if (diagnosticNoShadowBlur) Object.defineProperty(document.querySelector('canvas').getContext('2d'), 'shadowBlur', { get: () => 0, set: () => {} })
          const renderer = new RaceRenderer(document.querySelector('canvas'), track, { ...(raceGraphicsSettings?.(mode, count) ?? {}), timeOfDay, vehicleSpriteCache: !disableVehicleSprites })
          const physicsMs = [], renderMs = [], frameMs = [], workerPhysicsMs = [], snapshotAgeMs = []
          let lastSnapshot = 0
          const simulationStart = view.getSimulationTimeSeconds()
          for (let frame = 0; frame < frames; frame++) {
            const timestamp = await new Promise(resolve => requestAnimationFrame(resolve))
            const deltaSeconds = frameMs.length === 0 ? 0 : (timestamp - frameMs.at(-1)) / 1000
            frameMs.push(timestamp)
            const start = performance.now()
            if (driving && !fixedDriving) driveHumans()
            if (runtime) runtime.advanceFrame(deltaSeconds, {})
            else engine.advanceFrame(deltaSeconds)
            const physicsEnd = performance.now()
            renderer.render(view, deltaSeconds)
            if (runtime) {
              if (runtime.getFailure()) throw new Error(runtime.getFailure())
              const diagnostics = runtime.getDiagnostics()
              snapshotAgeMs.push(diagnostics.snapshotAgeMs)
              if (diagnostics.snapshotTimestamp !== lastSnapshot) {
                workerPhysicsMs.push(diagnostics.physicsMilliseconds)
                lastSnapshot = diagnostics.snapshotTimestamp
              }
            }
            if (frame >= 5) { physicsMs.push(physicsEnd - start); renderMs.push(performance.now() - physicsEnd) }
            if (timestamp - frameMs[0] >= maximumSeconds * 1000) break
          }
          const stats = values => ({ mean: values.reduce((a,b) => a+b,0)/values.length, p95: [...values].sort((a,b) => a-b)[Math.floor(values.length * .95)], max: Math.max(...values) })
          const wallSeconds = (frameMs.at(-1) - frameMs[0]) / 1000
          const simulatedSeconds = view.getSimulationTimeSeconds() - simulationStart
          const workerDiagnostics = runtime?.getDiagnostics()
          const result = { mode, cars: count, humans: racers.filter(r => r.kind === 'human').length, bots: racers.filter(r => r.kind === 'bot').length, timeOfDay, raceStatus: view.getStatus(), movingCars: view.getInterpolatedVehicles().filter(v => Math.hypot(v.velocity.x,v.velocity.y)>1).length, measuredFrames: physicsMs.length, wallSeconds, simulatedSeconds, simulationToWallRatio: simulatedSeconds / wallSeconds, physics: stats(physicsMs), renderer: stats(renderMs), frameInterval: stats(frameMs.slice(6).map((v,i) => v-frameMs[i+5])), worker: runtime ? { responses: workerPhysicsMs.length, physics: stats(workerPhysicsMs), snapshotAgeMs: stats(snapshotAgeMs), interpolationSamples: workerDiagnostics.interpolationSamples, interpolationUnderruns: workerDiagnostics.interpolationUnderruns } : null, renderStats: renderer.getRenderStats(), canvas: { width: document.querySelector('canvas').width, height: document.querySelector('canvas').height } }
          runtime?.dispose()
          if (workerUrl) URL.revokeObjectURL(workerUrl)
          return result
        }, { moduleUrl, workerCode, track, mode, driving: process.argv.includes('--driving'), fixedDriving: process.argv.includes('--fixed-driving'), frames: Number(process.env.PERF_FRAMES ?? 600), maximumSeconds: Number(process.env.PERF_MAX_SECONDS ?? 15), cars: process.env.PERF_CARS ? Number(process.env.PERF_CARS) : null, timeOfDay: process.env.PERF_TIME_OF_DAY ?? 'day', opaqueCanvas: process.env.PERF_OPAQUE === '1', desynchronized: process.env.PERF_DESYNCHRONIZED === '1', diagnosticNoShadowBlur: process.env.PERF_DIAGNOSTIC_NO_BLUR === '1', disableVehicleSprites: process.env.PERF_DISABLE_VEHICLE_SPRITES === '1' })
        const contextAttributes = await page.evaluate(() => document.querySelector('canvas').getContext('2d').getContextAttributes())
        const record = { baseline, browser: await browser.version(), track: trackId, contextAttributes,
          diagnosticNoShadowBlur: process.env.PERF_DIAGNOSTIC_NO_BLUR === '1', ...result }
        console.log(JSON.stringify(record))
        if (process.env.PERF_REPORT) {
          const report = resolve(process.env.PERF_REPORT)
          await mkdir(dirname(report), { recursive: true })
          await appendFile(report, JSON.stringify(record) + '\n')
        }
        if (profiler) {
          const { profile } = await profiler.send('Profiler.stop')
          const hits = new Map()
          for (const node of profile.nodes) hits.set(node.callFrame.functionName, (hits.get(node.callFrame.functionName) ?? 0) + (node.hitCount ?? 0))
          console.log(JSON.stringify({ sampledFunctions: [...hits].sort((a,b) => b[1]-a[1]).slice(0, 25) }))
          await profiler.detach()
        }
        if (process.env.PERF_SCREENSHOT_DIR) await page.screenshot({ path: resolve(process.env.PERF_SCREENSHOT_DIR, `${trackId}-${mode}.png`) })
        await page.close()
      }
    } finally { await browser.close() }
    process.exit(0)
  }
  const measuredSteps = Number(process.env.PERF_STEPS ?? 600)
  const result = { baseline, baselineRef: baseline ? baselineRef : null, track: trackId, physicsHz: 120, warmupSteps: 120, measuredSteps, cases: [] }
  for (const count of (process.env.PERF_COUNTS ?? '1,2,5,10,22').split(',').map(Number)) {
    const samples = []
    let state
    for (let run = 0; run < Number(process.env.PERF_RUNS ?? 3); run++) {
      const mode = process.env.PERF_MODES ?? (count === 2 ? 'local' : 'solo')
      const racers = process.env.PERF_MODES ? performanceRacers(mode, count) : Array.from({ length: count }, (_, i) => ({
        id: `car-${i}`, name: `Car ${i}`, kind: i === 0 || count === 2 ? 'human' : 'bot', botDifficulty: 'normal', color: '#2d7dff',
      }))
      const engine = new RaceEngine({ track, mode, racers })
      if (process.argv.includes('--fixed-driving')) {
        const step = engine.stepFixed.bind(engine)
        engine.stepFixed = () => {
          for (const racer of racers) if (racer.kind === 'human') engine.setInput(racer.id, engine.createBotInput(engine.getVehicleState(racer.id)))
          step()
        }
      }
      for (let i = 0; i < 120; i++) engine.stepFixed()
      const start = performance.now()
      for (let i = 0; i < measuredSteps; i++) engine.stepFixed()
      samples.push((performance.now() - start) / measuredSteps)
      state = engine.getInterpolatedVehicles().map(v => ({ id: v.id, position: v.position, velocity: v.velocity, angle: v.angle, damage: v.damage, physicsState: v.physicsState }))
    }
    samples.sort((a,b) => a-b)
    const median = samples[Math.floor(samples.length / 2)]
    const record = { cars: count, mode: process.env.PERF_MODES ?? (count === 2 ? 'local (no bots)' : 'solo'), medianStepMs: median, physicsPer60FpsFrameMs: median * 2,
      stateSha256: createHash('sha256').update(JSON.stringify(state)).digest('hex') }
    result.cases.push(record)
    console.log(JSON.stringify(record))
    if (process.argv.includes('--state')) console.log(JSON.stringify({ cars: count, state }))
  }
  console.log(JSON.stringify(result, null, 2))
}
