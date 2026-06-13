// server/utils/watermark.js
const { spawn } = require('child_process')
const path      = require('path')
const fs        = require('fs')
const storage   = require('./storage')
const config    = require('../config')

const WATERMARK_DIR    = path.join(__dirname, '../../watermark')
const PYTHON_BIN       = path.join(WATERMARK_DIR, 'venv/bin/python3')
const WATERMARK_SCRIPT = path.join(WATERMARK_DIR, 'watermark.py')
const MAX_RETRIES      = 2

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
        // Verificacion dudosa — el archivo existe pero la firma no se leyó bien
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

    // Si ya existe un PNG de intento anterior, borrarlo antes de reintentar
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

  // Generar thumb y preview desde el watermarked (aunque la verificacion fuera dudosa)
  await generateThumb(watermarkedPath,   path.join(thumbsDir,    stem + '.jpg'))
  await generatePreview(watermarkedPath, path.join(previewsDir,  stem + '.jpg'))

  console.log(`[watermark] Listo: ${filename} -> ${watermarkedName}${result.ok ? '' : ' (verificacion dudosa)'}`)

  return { watermarkedFilename: watermarkedName }
}

/**
 * Procesa un lote foto por foto.
 * @param {string} slug
 * @param {Array<{id, filename}>} photos
 * @param {function} onEach — callback(result) llamado tras cada foto
 */
async function processBatch(slug, photos, onEach) {
  console.log(`[watermark] Iniciando batch: ${slug} (${photos.length} fotos)`)
  const results = []

  for (const photo of photos) {
    let result
    try {
      const { watermarkedFilename } = await processPhoto({ slug, filename: photo.filename })
      result = { id: photo.id, watermarkedFilename, error: null }
    } catch (err) {
      console.error(`[watermark] Error en ${photo.filename}:`, err.message)
      result = { id: photo.id, watermarkedFilename: null, error: err.message }
    }

    results.push(result)
    if (onEach) onEach(result)
  }

  const ok   = results.filter(r => !r.error).length
  const fail = results.length - ok
  console.log(`[watermark] Batch terminado: ${slug} — ${ok} OK, ${fail} errores`)

  return results
}

module.exports = { processBatch, processPhoto, applyWatermark }
