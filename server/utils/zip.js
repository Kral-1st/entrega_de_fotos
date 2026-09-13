const archiver = require('archiver')
const path = require('path')
const fs = require('fs')
const { getOriginalsDir, getWatermarkedDir } = require('./storage')
const config = require('../config')

const buildingZips = new Map() // slug -> Promise, evita que dos requests armen el mismo ZIP a la vez

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
    const archive = archiver('zip', { store: true }) // sin compresión: PNG/JPEG ya vienen comprimidos
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
 * Sirve el ZIP de un proyecto. Si ya existe uno cacheado en disco, lo sirve
 * directo (sin CPU). Si no, lo arma una vez, lo deja cacheado, y lo sirve.
 */
function streamProjectZip(res, project, photos, opts = {}) {
  const { useWatermarked = false } = opts
  const zipName = `${project.slug}-fotos.zip`
  const cachePath = getCachePath(project.slug)

  if (fs.existsSync(cachePath)) {
    return serveZipFile(res, cachePath, zipName)
  }

  if (buildingZips.has(project.slug)) {
    // Ya se está armando por otra petición — esperar y servir el mismo archivo
    buildingZips.get(project.slug)
    .then(() => serveZipFile(res, cachePath, zipName))
    .catch(() => { if (!res.headersSent) res.status(500).json({ error: 'Error al generar el ZIP' }) })
    return
  }

  const buildPromise = buildZip(cachePath, project, photos, useWatermarked)
  buildingZips.set(project.slug, buildPromise)

  buildPromise
  .then(() => serveZipFile(res, cachePath, zipName))
  .catch((err) => {
    console.error('Error generando ZIP:', err)
    if (!res.headersSent) res.status(500).json({ error: 'Error al generar el ZIP' })
  })
  .finally(() => buildingZips.delete(project.slug))
}

/** Borra el ZIP cacheado de un proyecto — llamar cada vez que su contenido cambie. */
function invalidateZipCache(slug) {
  const cacheDir = path.join(path.dirname(config.paths.uploads), 'zip-cache')
  fs.unlink(path.join(cacheDir, `${slug}.zip`), () => {})
}

module.exports = { streamProjectZip, invalidateZipCache }
