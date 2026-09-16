// Requires the isolated H2 backend on :8081; refuses external API targets.
// Real Chrome contexts, REST authentication and WebSocket; no Neon or deployment.
import { createServer } from 'vite'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const api = 'http://127.0.0.1:8081/api'
const profile = process.argv.includes('--profile')
const maneuvers = process.argv.includes('--maneuvers')
const baseline = process.argv.includes('--baseline')
const trackId = process.env.ONLINE_SMOKE_TRACK ?? 'spielberg'
assert.match(trackId, /^[a-z0-9-]+$/)
const wireDelayMs = Number(process.env.ONLINE_SMOKE_DELAY_MS ?? 0)
assert.ok(Number.isFinite(wireDelayMs) && wireDelayMs >= 0 && wireDelayMs <= 200)
async function request(path, method = 'GET', body, token) {
  const res = await fetch(api + path, { method, headers: {
    'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await res.text()
  assert.ok(res.ok, `${method} ${path} ${res.status}: ${data}`)
  return data ? JSON.parse(data) : null
}
const { chromium } = await import(pathToFileURL(resolve('../never-lift-backend/tools/physics-parity/node_modules/playwright/index.mjs')).href)
const baselineRef = process.env.ONLINE_SMOKE_BASELINE_REF ?? 'd343cbb'
assert.match(baselineRef, /^[a-f0-9]{7,40}$/)
const baselinePrediction = baseline ? execFileSync('git', ['show', `${baselineRef}:src/online/OnlinePrediction.ts`], { encoding: 'utf8' }) : null
const server = await createServer({ envDir: false, plugins: baseline ? [{ name: 'diagnostic-baseline', enforce: 'pre',
  load(id) { if (id.replaceAll('\\', '/').endsWith('/src/online/OnlinePrediction.ts')) return baselinePrediction },
}] : [], define: {
  'import.meta.env.VITE_API_URL': JSON.stringify(api),
  'import.meta.env.VITE_WS_URL': JSON.stringify('ws://127.0.0.1:8081/ws'),
}, server: { host: '127.0.0.1', port: 5174, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = [], clients = [], output = 'output/online-3c'
let room, users
try {
  const suffix = Date.now().toString(36)
  users = await Promise.all([1, 2].map(async number => {
    const credentials = { gamertag: `smoke${suffix}${number}`, displayName: `M3c Piloto ${number}`, password: `M3c!${randomUUID()}` }
    return { ...credentials, ...await request('/auth/register', 'POST', credentials) }
  }))
  room = await request('/rooms', 'POST', { name: 'Smoke integrado 3c', visibility: 'private', trackId, gridSize: 3, botsEnabled: false }, users[0].token)
  room = room.room ?? room
  await request(`/rooms/${room.code}/join`, 'POST', undefined, users[1].token)
  await request(`/rooms/${room.code}/settings`, 'PATCH', { botsEnabled: true, botDifficulty: 'easy', laps: 2 }, users[0].token)
  const html = await server.transformIndexHtml('/__online-smoke', '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/tools/online-race-smoke-entry.tsx"></script></body></html>')
  for (const user of users) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    // Chrome's loopback permission belongs only to this disposable test context.
    const cdp = await context.newCDPSession(page)
    const { targetInfo } = await cdp.send('Target.getTargetInfo')
    await cdp.send('Browser.grantPermissions', { origin: 'http://127.0.0.1:5174',
      browserContextId: targetInfo.browserContextId, permissions: ['localNetworkAccess', 'loopbackNetwork'] })
    const client = { page, context, frames: [], events: [], snapshots: 0, inputs: [], snapshot: null }
    clients.push(client)
    page.on('pageerror', error => { errors.push(error.message); console.error(error.stack) })
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
    page.on('requestfailed', request => console.error('Request failed:', request.method(), request.url().split('?')[0], request.failure()?.errorText))
    page.on('response', response => { if (response.status() >= 400) console.error('HTTP', response.status(), response.url().split('?')[0]) })
    page.on('websocket', socket => {
      if (!socket.url().startsWith('ws://127.0.0.1:8081/ws')) return
      socket.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(String(payload))
        if (frame.type === 'state_snapshot') { client.snapshot = frame.payload; client.snapshots++ }
        else client.events.push(frame)
      })
      socket.on('framesent', ({ payload }) => {
        const frame = JSON.parse(String(payload))
        if (frame.type === 'input') client.inputs.push(frame.payload)
      })
    })
    await page.addInitScript(data => {
      window.onlineSmokeLogin = data
      window.onlineSmokeSockets = []
      const NativeSocket = window.WebSocket
      window.WebSocket = class extends NativeSocket {
        constructor(...args) { super(...args); if (String(args[0]).startsWith('ws://127.0.0.1:8081/ws')) window.onlineSmokeSockets.push(this) }
        set onmessage(listener) {
          super.onmessage = listener && (event => setTimeout(() => listener.call(this, event), data.delay))
        }
        send(payload) {
          setTimeout(() => { if (this.readyState === NativeSocket.OPEN) super.send(payload) }, data.delay)
        }
      }
    }, { gamertag: user.gamertag, password: user.password, code: room.code, delay: wireDelayMs })
    await page.route('**/__online-smoke', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto('http://127.0.0.1:5174/__online-smoke')
    await page.getByText('Pilotos', { exact: true }).waitFor({ timeout: 30000 })
    if (profile) await page.evaluate(async () => {
      const { OnlineRaceRuntime } = await import('/src/online/OnlineRaceRuntime.ts')
      const { RaceRenderer } = await import('/src/race/RaceRenderer.ts')
      const metrics = window.onlineSmokeMetrics = { receive: [], advance: [], render: [], movement: [], snapshots: [], corrections: [] }
      let previous
      for (const [prototype, key] of [[OnlineRaceRuntime.prototype, 'receive'], [OnlineRaceRuntime.prototype, 'advance'], [RaceRenderer.prototype, 'render']]) {
        const original = prototype[key]
        prototype[key] = function(...args) {
          const start = performance.now()
          const before = key === 'receive' && this.getSnapshot() ? this.getOwnState() : null
          const result = original.apply(this, args)
          if (metrics[key].length < 20000) metrics[key].push(performance.now() - start)
          if (key === 'receive' && args[0].type === 'state_snapshot') {
            const frame = this.getSnapshot()
            if (frame) metrics.snapshots.push({ at: start, substep: frame.physicsSubstep })
            if (before) { const after = this.getOwnState(); metrics.corrections.push({ at: start,
              distance: Math.hypot(after.position.x - before.position.x, after.position.y - before.position.y),
              yaw: Math.abs(after.physicsState.yawRate - before.physicsState.yawRate) }) }
          }
          if (key === 'render') {
            const runtime = args[0], car = runtime.getInterpolatedVehicles()[0], now = performance.now()
            if (car && previous) {
              const speed = Math.hypot(car.velocity.x, car.velocity.y)
              metrics.movement.push({ dt: args[1] * 1000, speed, health: car.damage.health,
                distance: Math.hypot(car.renderPosition.x - previous.x, car.renderPosition.y - previous.y) })
            }
            if (car) previous = { at: now, x: car.renderPosition.x, y: car.renderPosition.y }
          }
          return result
        }
      }
    })
  }
  await clients[1].page.getByRole('button', { name: 'Estou pronto', exact: true }).click()
  await clients[0].page.getByRole('button', { name: 'Iniciar classificação', exact: true }).click()
  for (const { page } of clients) {
    await page.getByLabel('Telemetria online').waitFor({ timeout: 30000 })
    await page.getByText('A melhor volta válida define o grid', { exact: true }).waitFor()
    await page.keyboard.down('w')
  }
  if (maneuvers) {
    await clients[0].page.waitForTimeout(4000)
    for (const { page } of clients) { await page.keyboard.up('w'); await page.keyboard.down('s') }
    await clients[0].page.waitForTimeout(700)
    for (const { page } of clients) { await page.keyboard.up('s'); await page.keyboard.down('w') }
    // Short steering changes expose command/ACK timing, not just straight speed.
    for (let pulse = 0; pulse < 12; pulse++) {
      const key = pulse < 6 ? 'd' : 'a'
      for (const { page } of clients) await page.keyboard.down(key)
      await clients[0].page.waitForTimeout(160)
      for (const { page } of clients) await page.keyboard.up(key)
      await clients[0].page.waitForTimeout(400)
    }
  } else await clients[0].page.waitForTimeout(profile ? 6000 : 1500)
  for (const { page } of clients) await page.keyboard.up('w')
  if (profile) for (const client of clients) client.measurements = await client.page.evaluate(() => window.onlineSmokeMetrics)
  for (const client of clients) {
    assert.ok(client.snapshot?.cars[0].speed > 0 || (maneuvers && client.measurements?.movement.some(v => v.speed > 5)), 'Real authoritative movement')
    assert.equal(client.snapshot.cars.length, 1, 'Qualifying isolation')
    assert.ok(client.inputs.some(input => input.throttle > 0), 'Keyboard sent real input')
    assert.equal(await client.page.getByRole('alert').count(), 0, 'No protocol/UI error')
  }
  const first = clients[0]
  await first.context.setOffline(true)
  // Chromium's offline toggle does not close an already established socket.
  await first.page.evaluate(() => window.onlineSmokeSockets.at(-1).close())
  await first.page.getByText(/Conexão interrompida/).waitFor({ timeout: 10000 })
  await first.context.setOffline(false)
  await first.page.getByText(/Conexão interrompida/).waitFor({ state: 'hidden', timeout: 30000 })
  await mkdir(output, { recursive: true })
  if (profile) {
    const measurements = clients.map(client => client.measurements)
    await writeFile(`${output}/browser-profile-${trackId}-${maneuvers ? 'maneuvers-' : ''}${baseline ? 'before' : 'after'}.json`, JSON.stringify({ trackId, baseline, wireDelayMs, measurements }, null, 2))
    for (const [index, m] of measurements.entries()) {
      const stats = values => {
        const sorted = [...values].sort((a,b) => a-b)
        return { count: sorted.length, p5: sorted[Math.floor(sorted.length*.05)], p50: sorted[Math.floor(sorted.length*.5)], p95: sorted[Math.floor(sorted.length*.95)], max: sorted.at(-1) }
      }
      const moving = m.movement.filter(v => v.speed > 5 && v.health === 100 && v.dt > 5 && v.dt < 40)
      const first = m.snapshots[0], last = m.snapshots.at(-1)
      console.log(JSON.stringify({ client: index+1, trackId, baseline, wireDelayMs, serverRealtimeRatio: (last.substep-first.substep)*1000/120/(last.at-first.at), receiveMs: stats(m.receive), advanceMs: stats(m.advance), renderMs: stats(m.render),
        snapshotGapMs: stats(m.snapshots.slice(1).map((v,i) => v.at - m.snapshots[i].at)), correctionsMeters: stats(m.corrections.map(v => v.distance)),
        frameMs: stats(m.movement.map(v => v.dt)), visualSpeedRatio: stats(moving.map(v => v.distance / (v.dt / 1000 * v.speed))) }))
    }
  }
  for (const [i, client] of clients.entries()) {
    await client.page.screenshot({ path: `${output}/qualifying-client-${i+1}.png` })
    await client.page.keyboard.press('Escape')
    await client.page.getByRole('alertdialog').waitFor()
    await client.page.getByRole('button', { name: 'Continuar na sala', exact: true }).click()
    assert.equal(client.snapshot.phase, 'qualifying')
  }
  assert.deepEqual(errors, [])
  const report = { passed: true, browser: 'Chrome headless', track: trackId, humans: 2, bots: 1,
    validated: ['real authentication/ticket/socket', 'lobby ready/start', 'isolated qualifying', 'keyboard to authoritative physics', 'reconnect', 'escape confirmation'],
    pending: ['two complete timed laps', 'race start to podium with real browsers', 'author manual integrated test'],
    clients: clients.map(client => ({ snapshots: client.snapshots, inputs: client.inputs.length, phase: client.snapshot?.phase })), errors }
  await writeFile(`${output}/browser-smoke.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} catch (error) {
  console.error(error)
  console.error('Browser errors:', errors)
  for (const client of clients) console.error((await client.page.locator('body').innerText()).slice(0, 4000))
  throw error
} finally {
  if (room && users?.[0]?.token) await request(`/rooms/${room.code}/close`, 'POST', undefined, users[0].token).catch(() => {})
  await browser.close(); await server.close()
}
