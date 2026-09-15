// Requires the isolated H2 backend on :8081; refuses external API targets.
// Real Chrome contexts, REST authentication and WebSocket; no Neon or deployment.
import { createServer } from 'vite'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

const api = 'http://127.0.0.1:8081/api'
async function request(path, method = 'GET', body, token) {
  const res = await fetch(api + path, { method, headers: {
    'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await res.text()
  assert.ok(res.ok, `${method} ${path} ${res.status}: ${data}`)
  return data ? JSON.parse(data) : null
}
const { chromium } = await import(pathToFileURL(resolve('../never-lift-backend/tools/physics-parity/node_modules/playwright/index.mjs')).href)
const server = await createServer({ envDir: false, define: {
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
  room = await request('/rooms', 'POST', { name: 'Smoke integrado 3c', visibility: 'private', trackId: 'spielberg', gridSize: 3, botsEnabled: false }, users[0].token)
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
      }
    }, { gamertag: user.gamertag, password: user.password, code: room.code })
    await page.route('**/__online-smoke', route => route.fulfill({ contentType: 'text/html', body: html }))
    await page.goto('http://127.0.0.1:5174/__online-smoke')
    await page.getByText('Pilotos', { exact: true }).waitFor({ timeout: 30000 })
  }
  await clients[1].page.getByRole('button', { name: 'Estou pronto', exact: true }).click()
  await clients[0].page.getByRole('button', { name: 'Iniciar classificação', exact: true }).click()
  for (const { page } of clients) {
    await page.getByLabel('Telemetria online').waitFor({ timeout: 30000 })
    await page.getByText('A melhor volta válida define o grid', { exact: true }).waitFor()
    await page.keyboard.down('w')
  }
  await clients[0].page.waitForTimeout(1500)
  for (const { page } of clients) await page.keyboard.up('w')
  for (const client of clients) {
    assert.ok(client.snapshot?.cars[0].speed > 0, 'Real authoritative movement')
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
  for (const [i, client] of clients.entries()) {
    await client.page.screenshot({ path: `${output}/qualifying-client-${i+1}.png` })
    await client.page.keyboard.press('Escape')
    await client.page.getByRole('alertdialog').waitFor()
    await client.page.getByRole('button', { name: 'Continuar na sala', exact: true }).click()
    assert.equal(client.snapshot.phase, 'qualifying')
  }
  assert.deepEqual(errors, [])
  const report = { passed: true, browser: 'Chrome headless', track: 'spielberg', humans: 2, bots: 1,
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
