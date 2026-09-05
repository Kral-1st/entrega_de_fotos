// server/utils/watermark.js
const { spawn } = require('child_process')
const path      = require('path')
const fs        = require('fs')
const storage   = require('./storage')
const config    = require('../config')
const watermarkQueue = require('./watermarkQueue')

const WATERMARK_DIR    = path.join(__dirname, '../../watermark')
const PYTHON_BIN       = path.join(WATERMARK_DIR, 'venv/bin/python3')
const WATERMARK_SCRIPT = path.join(WATERMARK_DIR, 'watermark.py')
const MAX_RETRIES      = 2

const CONCURRENCY = parseInt(process.env.WM_CONCURRENCY || '2', 10)

function applyWatermark(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, ['-u', WATERMARK_SCRIPT, inputPath, outputPath], {
      env: {
        ...process.env,
        WM_FIRMA:     process.env.WM_FIRMA     || '',
        WM_ALGORITMO: process.env.WM_ALGORITMO || 'dwtDctSvd',
      }
    })
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', d => {
      const line = d.toString().trim()
      if (line) {
        stdout += line
        console.log(`[watermark.py] ${line}`)
      }
    })

    proc.stderr.on('data', d => {
      const line = d.toString().trim()
      if (line) {
        stderr += line
        if (line.startsWith('[WARN]') || line.startsWith('[INFO]')) {
          console.log(`[watermark.py] ${line}`)
        } else {
          console.error(`[watermark.py] ${line}`)
        }
      }
    })

    proc.on('close', code => {
      if (code === 0) {
        resolve({ ok: true, outputPath })
      } else if (code === 2) {
        resolve({ ok: false, outputPath, retryable: true })
      } else {
        reject(new Error(`watermark.py fallo (exit ${code}): ${stderr.trim()}`))
      }
    })

    proc.on('error', err => reject(new Error(`No se pudo iniciar Python: ${err.message}`)))
  })
}

async function generateThumb(srcPath, thumbPath) {
  const sharp = require('sharp')
  await fs.promises.mkdir(path.dirname(thumbPath), { recursive: true })
  await sharp(srcPath)
  .resize(config.upload.thumbWidth, null, { withoutEnlargement: true, fit: 'inside' })
  .jpeg({ quality: config.upload.thumbQuality })
  .toFile(thumbPath)
}

async function generatePreview(srcPath, previewPath) {
  const sharp = require('sharp')
  await fs.promises.mkdir(path.dirname(previewPath), { recursive: true })
  await sharp(srcPath)
  .resize(config.upload.previewWidth, null, { withoutEnlargement: true, fit: 'inside' })
  .jpeg({ quality: config.upload.previewQuality })
  .toFile(previewPath)
}

async function processPhoto({ slug, filename }) {
  const originalsDir   = storage.getOriginalsDir(slug)
  const watermarkedDir = storage.getWatermarkedDir(slug)
  const thumbsDir      = storage.getThumbsDir(slug)
  const previewsDir    = storage.getPreviewsDir(slug)

  const inputPath       = path.join(originalsDir, filename)
  const stem            = path.parse(filename).name
  const watermarkedName = stem + '.png'
  const watermarkedPath = path.join(watermarkedDir, watermarkedName)

  console.log(`[watermark] Procesando: ${filename}`)

  let result
  let attempts = 0

  while (attempts < MAX_RETRIES) {
    attempts++

    if (attempts > 1 && fs.existsSync(watermarkedPath)) {
      fs.unlinkSync(watermarkedPath)
      console.log(`[watermark] Reintento ${attempts}/${MAX_RETRIES}: ${filename}`)
    }

    result = await applyWatermark(inputPath, watermarkedPath)

    if (result.ok) break

      if (!result.retryable || attempts >= MAX_RETRIES) {
        console.warn(`[watermark] Verificacion dudosa tras ${attempts} intento(s), se acepta: ${filename}`)
        break
      }
  }

  await generateThumb(watermarkedPath,   path.join(thumbsDir,   stem + '.jpg'))
  await generatePreview(watermarkedPath, path.join(previewsDir, stem + '.jpg'))

  console.log(`[watermark] Listo: ${filename} -> ${watermarkedName}${result.ok ? '' : ' (verificacion dudosa)'}`)

  return { watermarkedFilename: watermarkedName }
}

/**
 * Procesa un lote en paralelo con concurrencia controlada.
 * Lanza hasta CONCURRENCY fotos al mismo tiempo; cuando una termina
 * entra la siguiente, manteniendo siempre el slot ocupado.
 * onEach se llama en cuanto cada foto termina (orden de finalización,
 * no de inicio), igual que antes para que el polling siga funcionando.
 *
 * @param {string} slug
 * @param {Array<{id, filename}>} photos
 * @param {function} onEach — callback(result) llamado tras cada foto
 */
async function processBatch(slug, photos, onEach) {
  console.log(`[watermark] Iniciando batch: ${slug} (${photos.length} fotos, concurrencia local: ${CONCURRENCY})`)

  if (photos.length === 0) return []

    watermarkQueue.createBatch(slug, photos)

    const results = []
    watermarkQueue.setOnEach(slug, (result) => {
      results.push(result)
      if (onEach) onEach(result)
    })

    const donePromise = watermarkQueue.whenDone(slug)

    // Workers locales: cada uno jala de la cola compartida cuando tiene slot libre
    await Promise.all(Array.from({ length: CONCURRENCY }, () => runLocalPuller()))
    await donePromise // espera también a los workers remotos (TUF) que sigan trabajando

    const ok   = results.filter(r => !r.error).length
    const fail = results.length - ok
    console.log(`[watermark] Batch terminado: ${slug} — ${ok} OK, ${fail} errores`)

    return results
}

async function runLocalPuller() {
  while (true) {
    const job = watermarkQueue.getNextAny()
    if (!job) return
      const { batchId, id, filename } = job
      try {
        const { watermarkedFilename } = await processPhoto({ slug: batchId, filename })
        watermarkQueue.reportDone(batchId, { id, watermarkedFilename, error: null })
      } catch (err) {
        console.error(`[watermark] Error en ${filename}:`, err.message)
        watermarkQueue.reportDone(batchId, { id, watermarkedFilename: null, error: err.message })
      }
  }
}

module.exports = { processBatch, processPhoto, applyWatermark }
