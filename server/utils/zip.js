const archiver = require('archiver')
const path = require('path')
const fs = require('fs')
const { getOriginalsDir, getWatermarkedDir } = require('./storage')
const config = require('../config')

const buildingZips = new Map() // slug -> Promise

function getCachePath(slug) {
  const cacheDir = path.join(path.dirname(config.paths.uploads), 'zip-cache')
  fs.mkdirSync(cacheDir, { recursive: true })
  return path.join(cacheDir, `${slug}.zip`)
}

function serveZipFile(res, filePath, zipName) {
  const { size } = fs.statSync(filePath)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`)
  res.setHeader('Content-Length', size)
  const readStream = fs.createReadStream(filePath)
  readStream.pipe(res)
  readStream.on('error', (err) => console.error('Error leyendo ZIP cacheado:', err))
}

function buildZip(cachePath, project, photos, useWatermarked) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { store: true })
    const output = fs.createWriteStream(cachePath)

    archive.on('error', (err) => { fs.unlink(cachePath, () => {}); reject(err) })
    output.on('error', (err) => { fs.unlink(cachePath, () => {}); reject(err) })
    output.on('close', resolve)

    archive.pipe(output)

    for (const photo of photos) {
      let filePath, archiveName
      if (useWatermarked) {
        const stem = photo.filename.replace(/\.[^.]+$/, '')
        const watermarkedFile = photo.watermarked_filename || (stem + '.png')
        filePath = path.join(getWatermarkedDir(project.slug), watermarkedFile)
        archiveName = photo.original_name
        ? photo.original_name.replace(/\.[^.]+$/, '.png')
        : watermarkedFile
      } else {
        filePath = path.join(getOriginalsDir(project.slug), photo.filename)
        archiveName = photo.original_name
      }

      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: archiveName })
      } else {
        console.warn(`[zip] Archivo no encontrado, omitido: ${filePath}`)
      }
    }

    archive.finalize()
  })
}

/**
 * Sirve el ZIP si ya está listo en caché. Si no, dispara (o reusa) la
 * generación en segundo plano y responde 202 de inmediato — nunca deja
 * una sola conexión HTTP esperando la generación completa, porque
 * Cloudflare corta conexiones al origin después de ~100s y un ZIP de
 * fotos pesadas puede tardar más que eso.
 */
function streamProjectZip(res, project, photos, opts = {}) {
  const { useWatermarked = false } = opts
  const zipName = `${project.slug}-fotos.zip`
  const cachePath = getCachePath(project.slug)

  // Ojo con el orden: primero buildingZips, porque el archivo puede EXISTIR
  // en disco (createWriteStream lo crea desde el primer byte) sin estar
  // completo todavía.
  if (!buildingZips.has(project.slug) && fs.existsSync(cachePath)) {
    return serveZipFile(res, cachePath, zipName)
  }

  if (!buildingZips.has(project.slug)) {
    const buildPromise = buildZip(cachePath, project, photos, useWatermarked)
    buildingZips.set(project.slug, buildPromise)
    buildPromise
    .catch(err => console.error('Error generando ZIP:', err))
    .finally(() => buildingZips.delete(project.slug))
  }

  res.status(202).json({ building: true, message: 'Generando el ZIP, intenta de nuevo en unos segundos' })
}

/** Igual que streamProjectZip pero para pregenerar en background, sin response. */
function pregenerateZip(project, photos) {
  const cachePath = getCachePath(project.slug)

  if (!buildingZips.has(project.slug) && fs.existsSync(cachePath)) return Promise.resolve()
    if (buildingZips.has(project.slug)) return buildingZips.get(project.slug)

      const buildPromise = buildZip(cachePath, project, photos, true)
      buildingZips.set(project.slug, buildPromise)
      buildPromise.finally(() => buildingZips.delete(project.slug))
      return buildPromise
}

/** true si el ZIP ya está listo en caché y no se está regenerando ahora mismo. */
function zipReady(slug) {
  const cacheDir = path.join(path.dirname(config.paths.uploads), 'zip-cache')
  return !buildingZips.has(slug) && fs.existsSync(path.join(cacheDir, `${slug}.zip`))
}

/** Borra el ZIP cacheado — SÍNCRONO a propósito, para que quien llame después
 *  (ej. pregenerateZip inmediatamente después) nunca vea el archivo viejo
 *  todavía ahí por una condición de carrera con un unlink asíncrono. */
function invalidateZipCache(slug) {
  const cacheDir = path.join(path.dirname(config.paths.uploads), 'zip-cache')
  try {
    fs.unlinkSync(path.join(cacheDir, `${slug}.zip`))
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[zip] Error invalidando caché:', err.message)
  }
}

module.exports = { streamProjectZip, pregenerateZip, invalidateZipCache, zipReady }
