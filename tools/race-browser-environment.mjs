// Read-only diagnostics for interpreting the headless benchmark, not the user's open browser.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(pathToFileURL(resolve('../never-lift-backend/tools/physics-parity/node_modules/playwright/index.mjs')).href)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const cdp = await browser.newBrowserCDPSession()
  const { gpu } = await cdp.send('SystemInfo.getInfo')
  console.log(JSON.stringify({ browser: await browser.version(), devices: gpu.devices,
    featureStatus: gpu.featureStatus, renderer: gpu.auxAttributes?.glRenderer,
    implementation: gpu.auxAttributes?.glImplementationParts }, null, 2))
} finally { await browser.close() }
