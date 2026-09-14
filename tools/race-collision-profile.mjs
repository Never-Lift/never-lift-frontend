// Offline diagnosis only. Ablations never enter the application or acceptance runs.
import { build } from 'vite'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { Session } from 'node:inspector/promises'

const baseline = process.env.COLLISION_BASE_REF
const ablation = process.env.COLLISION_ABLATION ?? 'full'
if (!['full', 'no-cars', 'no-walls', 'none'].includes(ablation)) throw new Error('Invalid diagnostic ablation')
const instrument = process.argv.includes('--instrument')
const root = process.cwd().replaceAll('\\', '/')
globalThis.collisionProbe = {}
const targets = {
  'collision.ts': ['resolveVehicleCollision', 'resolveVehicleBarrierCollisions'],
  'continuous-collision.ts': ['sweepCompoundCollidersWithRotation'],
  'rigid-body-collision.ts': ['resolveRigidBodyCollisions'],
}
const bundle = await build({ configFile: false, logLevel: 'error', resolve: { alias: { '@': resolve('src') } },
  plugins: [{ name: 'collision-diagnosis', enforce: 'pre', async load(id) {
    const normalized = id.replaceAll('\\', '/')
    if (!normalized.startsWith(root + '/src/race/') || !id.endsWith('.ts')) return
    let source = baseline ? execFileSync('git', ['show', `${baseline}:${normalized.slice(root.length + 1)}`], { encoding: 'utf8' }) : await readFile(id, 'utf8')
    for (const name of targets[normalized.split('/').at(-1)] ?? []) {
      const omit = (name === 'resolveVehicleCollision' && ['no-cars', 'none'].includes(ablation)) ||
        (name === 'resolveVehicleBarrierCollisions' && ['no-walls', 'none'].includes(ablation))
      if (!instrument && !omit) continue
      const declaration = `export function ${name}(`
      if (!source.includes(declaration)) throw new Error(`Missing function ${name}`)
      source = source.replace(declaration, `function ${name}Original(`)
      source += `\nexport function ${name}(...args: Parameters<typeof ${name}Original>): ReturnType<typeof ${name}Original> {
        ${omit ? 'return false' : `const start = performance.now()
        const result = ${name}Original(...args)
        const elapsed = performance.now() - start
        const key = '${name}' + (${name === 'resolveVehicleBarrierCollisions' ? "args[2] === 0 ? ':overlap' : ':motion'" : "''"})
        const row = globalThis.collisionProbe[key] ??= { calls: 0, hits: 0, milliseconds: 0, maximum: 0 }
        row.calls++; row.hits += result ? 1 : 0; row.milliseconds += elapsed; row.maximum = Math.max(row.maximum, elapsed)
        return result`}
      }\n`
    }
    return source
  } }],
  build: { ssr: true, write: false, minify: false, rolldownOptions: { input: resolve('tools/race-performance-entry.ts') } },
})
const code = bundle.output.find(item => item.type === 'chunk' && item.isEntry).code
const { RaceEngine, performanceRacers } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const trackId = process.env.COLLISION_TRACK ?? 'spa-francorchamps'
const track = JSON.parse(await readFile(`../never-lift-backend/contracts/module-2/v2/tracks/${trackId}.json`, 'utf8'))
const mode = process.env.COLLISION_MODE ?? 'solo'
const cars = Number(process.env.COLLISION_CARS ?? 22)
const steps = Number(process.env.COLLISION_STEPS ?? 3600)
const engine = new RaceEngine({ track, mode, racers: performanceRacers(mode, cars), lapCount: 3 })
const humans = engine.getInterpolatedVehicles().filter(car => car.kind === 'human')
const profiler = process.argv.includes('--profile') ? new Session() : null
if (profiler) { profiler.connect(); await profiler.post('Profiler.enable'); await profiler.post('Profiler.start') }
const seconds = [], durations = [], hashes = []
let samples = []
for (let tick = 0; tick < steps; tick++) {
  const start = performance.now()
  for (const human of humans) engine.setInput(human.id, engine.createBotInput(engine.getVehicleState(human.id)))
  engine.stepFixed()
  const elapsed = performance.now() - start
  durations.push(elapsed); samples.push(elapsed)
  if ((tick + 1) % 120 === 0) {
    const vehicles = engine.getInterpolatedVehicles()
    const state = vehicles.map(({ id, position, velocity, angle, damage, physicsState }) => ({ id, position, velocity, angle, damage, physicsState }))
    hashes.push(createHash('sha256').update(JSON.stringify(state)).digest('hex'))
    seconds.push({ second: (tick + 1) / 120, meanMs: samples.reduce((a,b) => a+b,0) / samples.length,
      maxMs: Math.max(...samples), collisions: globalThis.collisionProbe,
      impacts: vehicles.reduce((sum, car) => sum + car.damage.impactCount, 0),
      playerDistance: vehicles[0].trackDistanceMeters, speed: Math.hypot(vehicles[0].velocity.x,vehicles[0].velocity.y) })
    samples = []; globalThis.collisionProbe = {}
  }
}
let profile
if (profiler) { ({ profile } = await profiler.post('Profiler.stop')); profiler.disconnect() }
durations.sort((a,b)=>a-b)
const totals = {}
for (const second of seconds) for (const [name,row] of Object.entries(second.collisions)) {
  const total = totals[name] ??= { calls: 0, hits: 0, milliseconds: 0, maximum: 0 }
  for (const key of ['calls','hits','milliseconds']) total[key] += row[key]
  total.maximum = Math.max(total.maximum,row.maximum)
}
const hottest = profile ? Object.entries(profile.nodes.reduce((acc,node) => {
  const name = node.callFrame.functionName || '(anonymous)'
  acc[name] = (acc[name] ?? 0) + (node.hitCount ?? 0); return acc
}, {})).sort((a,b)=>b[1]-a[1]).slice(0,25) : undefined
const result = { baseline, ablation, instrument, track: trackId, mode, cars, steps,
  stepMs: { mean: durations.reduce((a,b)=>a+b,0)/durations.length, p95: durations[Math.floor(durations.length*.95)], max: durations.at(-1) },
  totals, hottest, seconds, hashes }
const report = resolve(process.env.COLLISION_REPORT ?? 'output/performance/collision-profile.json')
await mkdir(dirname(report), { recursive: true }); await writeFile(report, JSON.stringify(result,null,2))
if (profile) await writeFile(report + '.cpuprofile', JSON.stringify(profile))
console.log(JSON.stringify({ ...result, seconds: undefined, hashes: undefined, report },null,2))
