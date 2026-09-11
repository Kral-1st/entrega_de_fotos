// server/worker-client.js
// Proceso standalone: corre en TUF, hace polling infinito a SERVER
// pidiendo trabajo cuando tiene slot libre. No importa qué proyecto
// se esté procesando — este worker jala de cualquier batch activo.
require('dotenv').config()
const { processPhoto } = require('./utils/watermark')

const SERVER_URL    = process.env.WORKER_SERVER_URL
const WORKER_SECRET = process.env.WM_WORKER_SECRET
const CONCURRENCY   = parseInt(process.env.WORKER_CONCURRENCY || '4', 10)
const POLL_IDLE_MS  = 2000

async function fetchNext() {
    const res = await fetch(`${SERVER_URL}/internal/worker/next`, {
        headers: { 'x-worker-secret': WORKER_SECRET }
    })
    if (res.status === 204) return null
        if (!res.ok) throw new Error(`next() falló: ${res.status}`)
            return res.json()
}

async function reportDone(batchId, result) {
    await fetch(`${SERVER_URL}/internal/worker/done`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-worker-secret': WORKER_SECRET },
        body: JSON.stringify({ batchId, ...result })
    })
}

async function pullerLoop(workerNum) {
    while (true) {
        let job
        try {
            job = await fetchNext()
        } catch (err) {
            console.error(`[worker-${workerNum}] Error consultando SERVER: ${err.message}`)
            await new Promise(r => setTimeout(r, POLL_IDLE_MS))
            continue
        }

        if (!job) {
            await new Promise(r => setTimeout(r, POLL_IDLE_MS))
            continue
        }

        const { batchId, id, filename } = job
        console.log(`[worker-${workerNum}] Procesando: ${filename} (batch ${batchId})`)

        try {
            const { watermarkedFilename } = await processPhoto({ slug: batchId, filename })
            await reportDone(batchId, { id, watermarkedFilename, error: null })
        } catch (err) {
            console.error(`[worker-${workerNum}] Error en ${filename}: ${err.message}`)
            await reportDone(batchId, { id, watermarkedFilename: null, error: err.message })
        }
    }
}

async function main() {
    if (!SERVER_URL || !WORKER_SECRET) {
        console.error('[worker] Faltan WORKER_SERVER_URL o WM_WORKER_SECRET en el .env')
        process.exit(1)
    }
    console.log(`[worker] Conectando a ${SERVER_URL}, concurrencia ${CONCURRENCY}`)
    await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => pullerLoop(i + 1)))
}

main()
