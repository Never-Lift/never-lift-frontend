import { spawn } from 'node:child_process'
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { cpus, platform, release } from 'node:os'
import { resolve } from 'node:path'

const catalog = resolve(process.env.PERF_CATALOG_ROOT ?? '../never-lift-backend/contracts/module-2/v2/tracks')
const requested = process.env.PERF_TRACKS?.split(',')
const tracks = (await readdir(catalog)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).filter(id => !requested || requested.includes(id)).sort()
const output = resolve(process.env.PERF_MATRIX_DIR ?? 'output/performance/matrix')
await mkdir(output, { recursive: true })
await writeFile(resolve(output, 'environment.json'), JSON.stringify({ recordedAt: new Date().toISOString(), cpu: cpus()[0]?.model,
  logicalCpus: cpus().length, platform: platform(), osRelease: release(), node: process.version,
  secondsPerCase: Number(process.env.PERF_MAX_SECONDS ?? 20), tracks, note: 'Sequential real headless-browser measurements; not fabricated estimates or universal FPS guarantees.' }, null, 2))
const failures = []
for (const track of tracks) {
  const definition = JSON.parse(await readFile(resolve(catalog, `${track}.json`), 'utf8'))
  console.log(`Testing ${definition.name}: solo 1+21 and local 2+20`)
  const code = await new Promise(resolveExit => {
    const child = spawn(process.execPath, ['tools/race-performance.mjs', '--browser', '--fixed-driving', '--worker'], {
      stdio: 'inherit', env: { ...process.env, PERF_TRACK: track, PERF_MODES: 'solo,local', PERF_CARS: '22', PERF_FRAMES: '100000',
        PERF_MAX_SECONDS: process.env.PERF_MAX_SECONDS ?? '20', PERF_REPORT: resolve(output, `${track}.jsonl`) },
    })
    child.on('error', error => { console.error(error.message); resolveExit(1) })
    child.on('exit', resolveExit)
  })
  if (code !== 0) failures.push(track)
}
console.log(JSON.stringify({ completed: tracks.length, failures, output }))
if (failures.length) process.exitCode = 1
