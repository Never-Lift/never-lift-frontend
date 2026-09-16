// Local-only video inspection through Chrome's MP4 decoder.
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const source = resolve(process.argv[2])
const info = await stat(source)
const { chromium } = await import(pathToFileURL(resolve('../never-lift-backend/tools/physics-parity/node_modules/playwright/index.mjs')).href)
const server = createServer((req, res) => {
  if (req.url !== '/video') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<video id="v" src="/video" preload="auto" muted></video>'); return }
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/)
  const start = range ? Number(range[1]) : 0
  const end = range?.[2] ? Number(range[2]) : info.size-1
  res.writeHead(range ? 206 : 200, { 'Content-Type':'video/mp4', 'Accept-Ranges':'bytes', 'Content-Length': end-start+1,
    ...(range ? { 'Content-Range':`bytes ${start}-${end}/${info.size}` } : {}) })
  createReadStream(source, { start, end }).pipe(res)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel:'chrome', headless:true })
try {
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2)
  const data = await page.evaluate(async () => {
    const v = document.querySelector('video'), c = document.createElement('canvas')
    const w=640, h=Math.round(v.videoHeight/v.videoWidth*w)
    c.width=w*4; c.height=(h+24)*4
    const ctx=c.getContext('2d')
    for(let i=0;i<16;i++) {
      const t=Math.min(v.duration-.1, .1+i*v.duration/16)
      await new Promise(resolve => { v.requestVideoFrameCallback(resolve); v.currentTime=t })
      ctx.drawImage(v,(i%4)*w,Math.floor(i/4)*(h+24),w,h)
      ctx.fillStyle='#111';ctx.fillRect((i%4)*w,Math.floor(i/4)*(h+24)+h,w,24)
      ctx.fillStyle='#fff';ctx.font='16px monospace';ctx.fillText(t.toFixed(2)+'s',(i%4)*w+6,Math.floor(i/4)*(h+24)+h+18)
    }
    return { duration:v.duration,width:v.videoWidth,height:v.videoHeight, image:c.toDataURL('image/jpeg',.9) }
  })
  await mkdir('output/online-video-2026-09-15',{recursive:true})
  await writeFile('output/online-video-2026-09-15/contact.jpg',Buffer.from(data.image.split(',')[1],'base64'))
  console.log(JSON.stringify({duration:data.duration,width:data.width,height:data.height}))
  if (process.argv.includes('--cadence')) {
    const cadence = await page.evaluate(async () => {
      const v = document.querySelector('video'), c = document.createElement('canvas')
      c.width = 320; c.height = 160
      const ctx = c.getContext('2d', { willReadFrequently: true })
      const samples = []; let previous
      for (let t = 4; t < Math.min(v.duration, 36); t += 1 / 15) {
        await new Promise(resolve => { v.requestVideoFrameCallback(resolve); v.currentTime = t })
        // World only: exclude menu/HUD and the mouse near the screen edge.
        ctx.drawImage(v, 200, 130, v.videoWidth - 500, v.videoHeight - 320, 0, 0, 320, 160)
        const pixels = ctx.getImageData(0, 0, 320, 160).data
        let difference = 0
        if (previous) for (let i = 0; i < pixels.length; i += 4)
          difference += Math.abs(pixels[i] - previous[i]) + Math.abs(pixels[i+1] - previous[i+1]) + Math.abs(pixels[i+2] - previous[i+2])
        samples.push({ time: t, meanRgbDifference: previous ? difference / (320 * 160 * 3) : null })
        previous = pixels
      }
      return samples
    })
    await writeFile('output/online-video-2026-09-15/cadence.json', JSON.stringify(cadence))
    const pauses = []; let start = null
    for (const sample of cadence) {
      if (sample.meanRgbDifference !== null && sample.meanRgbDifference < .05) start ??= sample.time - 1 / 15
      else if (start !== null) { if (sample.time - start > .4) pauses.push({ start, end: sample.time, seconds: sample.time - start }); start = null }
    }
    console.log(JSON.stringify({ nearStaticWorldIntervals: pauses }))
  }
} finally { await browser.close(); server.close() }
