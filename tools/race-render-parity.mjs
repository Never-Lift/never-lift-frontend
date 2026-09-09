// Compare actual Canvas pixels from identical poses, not screenshots at different race times.
import { build } from 'vite'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const baseRef = process.env.PERF_BASE_REF ?? '9391e7e'
const perceptualAudit = process.env.PERF_PERCEPTUAL_AUDIT === '1'
async function bundle(baseline) {
  const result = await build({ configFile: false, logLevel: 'error', resolve: { alias: { '@': resolve('src') } },
    build: { ssr: true, write: false, minify: false, rolldownOptions: { input: resolve('tools/race-performance-entry.ts') } },
    plugins: baseline ? [{ name: 'original-renderer', enforce: 'pre', load(id) {
      const prefix = root.replaceAll('\\', '/') + '/src/race/'
      if (!id.replaceAll('\\', '/').startsWith(prefix) || !id.endsWith('.ts')) return
      return execFileSync('git', ['show', baseRef + ':src/race/' + id.slice(prefix.length)], { encoding: 'utf8' })
    } }] : [],
  })
  return 'data:text/javascript;base64,' + Buffer.from(result.output.find(item => item.type === 'chunk' && item.isEntry).code).toString('base64')
}
const before = await bundle(true), after = await bundle(false)
const { chromium } = await import(pathToFileURL(resolve('../never-lift-backend/tools/physics-parity/node_modules/playwright/index.mjs')).href)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
let failed = false
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.setContent('<style>canvas{position:absolute;width:1920px;height:1080px;inset:0}</style><canvas id="before"></canvas><canvas id="after"></canvas>')
  for (const id of (process.env.PERF_TRACKS ?? 'monaco,austin,suzuka,spa-francorchamps').split(',')) {
    const track = JSON.parse(await readFile(resolve('../never-lift-backend/contracts/module-2/v2/tracks', `${id}.json`), 'utf8'))
    for (const timeOfDay of ['day', 'night']) {
      const result = await page.evaluate(async ({ before, after, track, timeOfDay }) => {
        const original = await import(before), current = await import(after)
        const engine = new current.RaceEngine({ track, mode: 'local', racers: current.performanceRacers('local', 22) })
        const a = new original.RaceRenderer(document.getElementById('before'), track, { ...current.raceGraphicsSettings('local', 22), timeOfDay })
        const b = new current.RaceRenderer(document.getElementById('after'), track, { ...current.raceGraphicsSettings('local', 22), timeOfDay })
        let differing = 0, differingPixels = 0, maximumChannelError = 0
        let absoluteError = 0, squaredError = 0, comparedChannels = 0
        for (let frame = 0; frame < 4; frame++) {
          // Both see precisely the same state, including crossed layers/bounds.
          const vehicles = engine.getInterpolatedVehicles()
          const sample = track.centerline[Math.floor(track.centerline.length * frame / 4)]
          for (let index = 0; index < vehicles.length; index++) {
            vehicles[index].renderPosition = { x: sample.x + index % 4 * 4, y: sample.y + Math.floor(index / 4) * 8 }
            vehicles[index].renderAngle = frame * 0.71
            vehicles[index].velocity = { x: 10 * Math.cos(frame * 0.71), y: 10 * Math.sin(frame * 0.71) }
            vehicles[index].trackDistanceMeters = sample.distanceMeters
            vehicles[index].trackLayer = sample.elevationLayer
          }
          const view = { mode: 'local', getInterpolatedVehicles: () => vehicles }
          a.render(view, 1 / 60); b.render(view, 1 / 60)
          const left = document.getElementById('before').getContext('2d').getImageData(0, 0, 1920, 1080).data
          const right = document.getElementById('after').getContext('2d').getImageData(0, 0, 1920, 1080).data
          comparedChannels += left.length
          for (let i = 0; i < left.length; i += 4) {
            let pixelDiffers = false
            for (let channel = 0; channel < 4; channel++) {
              const difference = Math.abs(left[i + channel] - right[i + channel])
              if (difference > 0) { differing++; pixelDiffers = true }
              absoluteError += difference
              squaredError += difference * difference
              maximumChannelError = Math.max(maximumChannelError, difference)
            }
            if (pixelDiffers) differingPixels++
          }
        }
        return {
          frames: 4,
          differingChannels: differing,
          differingPixels,
          differingPixelPercent: differingPixels / (comparedChannels / 4) * 100,
          meanAbsoluteChannelError: absoluteError / comparedChannels,
          rootMeanSquareChannelError: Math.sqrt(squaredError / comparedChannels),
          maximumChannelError,
        }
      }, { before, after, track, timeOfDay })
      console.log(JSON.stringify({ track: id, timeOfDay, baseRef, ...result }))
      if (process.env.PERF_CAPTURE_VISUAL === '1') {
        await mkdir('output/performance/perceptual-audit', { recursive: true })
        for (const canvasId of ['before', 'after']) {
          const dataUrl = await page.$eval(`#${canvasId}`, canvas => canvas.toDataURL('image/png'))
          await writeFile(
            `output/performance/perceptual-audit/${id}-${timeOfDay}-${canvasId}.png`,
            Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'),
          )
        }
      }
      if (result.differingChannels && !perceptualAudit) failed = true
    }
  }
  await mkdir('output/performance', { recursive: true })
  await page.screenshot({ path: 'output/performance/render-parity-last.png' })
} finally { await browser.close() }
if (failed) process.exitCode = 1
