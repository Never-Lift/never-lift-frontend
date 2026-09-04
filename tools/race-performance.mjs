// Reproducible CPU probe, not a hardware-sensitive CI pass/fail assertion.
// --baseline loads committed race sources through Vite without touching the checkout.
import { execFileSync } from 'node:child_process'
import { deepStrictEqual } from 'node:assert'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

const root = process.cwd()
const baseline = process.argv.includes('--baseline')
const baselineRef = process.env.PERF_BASE_REF ?? 'HEAD'
const bundle = await build({
  configFile: false,
  resolve: { alias: { '@': resolve(root, 'src') } },
  logLevel: 'error',
  build: { ssr: true, write: false, minify: false, rolldownOptions: { input: resolve(root, 'tools/race-performance-entry.ts') } },
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
  const { RaceEngine, TrackGeometry } = await import(moduleUrl)
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
  if (process.argv.includes('--browser')) {
    const playwrightPath = resolve(process.env.PERF_PLAYWRIGHT_MODULE ?? '../never-lift-backend/tools/physics-parity/node_modules/playwright/index.mjs')
    const { chromium } = await import(pathToFileURL(playwrightPath).href)
    const browser = await chromium.launch({ headless: true, channel: process.env.PERF_BROWSER ?? 'msedge' })
    try {
      for (const mode of (process.env.PERF_MODES ?? 'solo,local').split(',')) {
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: Number(process.env.PERF_DPR ?? 1) })
        await page.setContent('<style>html,body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas>')
        const profiler = process.argv.includes('--profile') ? await page.context().newCDPSession(page) : null
        if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.start') }
        const result = await page.evaluate(async ({ moduleUrl, track, mode, baseline, driving, frames, maximumSeconds }) => {
          const { RaceEngine, RaceRenderer, raceGraphicsSettings } = await import(moduleUrl)
          const count = mode === 'solo' ? 22 : 2
          const engine = new RaceEngine({ track, mode, racers: Array.from({ length: count }, (_, i) => ({
            id: i < 2 ? `player-${i + 1}` : `bot-${i}`, name: `Car ${i}`, kind: i === 0 || mode === 'local' ? 'human' : 'bot', botDifficulty: 'normal', color: '#2d7dff',
          })) })
          const renderer = new RaceRenderer(document.querySelector('canvas'), track, baseline ? {} : raceGraphicsSettings(mode, count))
          const physicsMs = [], renderMs = [], frameMs = []
          for (let frame = 0; frame < frames; frame++) {
            const timestamp = await new Promise(resolve => requestAnimationFrame(resolve))
            const deltaSeconds = frameMs.length === 0 ? 0 : (timestamp - frameMs.at(-1)) / 1000
            frameMs.push(timestamp)
            const start = performance.now()
            if (driving) for (const id of (mode === 'local' ? ['player-1', 'player-2'] : ['player-1'])) {
              engine.setInput(id, engine.createBotInput(engine.getVehicleState(id)))
            }
            engine.advanceFrame(deltaSeconds)
            const physicsEnd = performance.now()
            renderer.render(engine, deltaSeconds)
            if (frame >= 5) { physicsMs.push(physicsEnd - start); renderMs.push(performance.now() - physicsEnd) }
            if (timestamp - frameMs[0] >= maximumSeconds * 1000) break
          }
          const stats = values => ({ mean: values.reduce((a,b) => a+b,0)/values.length, p95: [...values].sort((a,b) => a-b)[Math.floor(values.length * .95)] })
          const wallSeconds = (frameMs.at(-1) - frameMs[0]) / 1000
          return { mode, cars: count, measuredFrames: physicsMs.length, wallSeconds, simulatedSeconds: engine.getSimulationTimeSeconds(), simulationToWallRatio: engine.getSimulationTimeSeconds() / wallSeconds, physics: stats(physicsMs), renderer: stats(renderMs), frameInterval: stats(frameMs.slice(6).map((v,i) => v-frameMs[i+5])), renderStats: renderer.getRenderStats(), canvas: { width: document.querySelector('canvas').width, height: document.querySelector('canvas').height } }
        }, { moduleUrl, track, mode, baseline, driving: process.argv.includes('--driving'), frames: Number(process.env.PERF_FRAMES ?? 600), maximumSeconds: Number(process.env.PERF_MAX_SECONDS ?? 15) })
        console.log(JSON.stringify({ baseline, browser: await browser.version(), track: trackId, ...result }))
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
      const engine = new RaceEngine({ track, mode: count === 2 ? 'local' : 'solo', racers: Array.from({ length: count }, (_, i) => ({
        id: `car-${i}`, name: `Car ${i}`, kind: i === 0 || count === 2 ? 'human' : 'bot', botDifficulty: 'normal', color: '#2d7dff',
      })) })
      for (let i = 0; i < 120; i++) engine.stepFixed()
      const start = performance.now()
      for (let i = 0; i < measuredSteps; i++) engine.stepFixed()
      samples.push((performance.now() - start) / measuredSteps)
      state = engine.getInterpolatedVehicles().map(v => ({ id: v.id, position: v.position, velocity: v.velocity, angle: v.angle, damage: v.damage, physicsState: v.physicsState }))
    }
    samples.sort((a,b) => a-b)
    const median = samples[Math.floor(samples.length / 2)]
    const record = { cars: count, mode: count === 2 ? 'local (no bots)' : 'solo', medianStepMs: median, physicsPer60FpsFrameMs: median * 2,
      stateSha256: createHash('sha256').update(JSON.stringify(state)).digest('hex') }
    result.cases.push(record)
    console.log(JSON.stringify(record))
    if (process.argv.includes('--state')) console.log(JSON.stringify({ cars: count, state }))
  }
  console.log(JSON.stringify(result, null, 2))
}
