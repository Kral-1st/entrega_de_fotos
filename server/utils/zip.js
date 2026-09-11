const archiver = require('archiver')
const path = require('path')
const fs = require('fs')
const { getOriginalsDir, getWatermarkedDir } = require('./storage')

/**
 * Streamea un ZIP con todas las fotos de un proyecto directamente al response de Express.
 * @param {object} res       — Express response
 * @param {object} project   — proyecto (necesita slug)
 * @param {Array}  photos    — lista de fotos de la DB
 * @param {object} opts
 * @param {boolean} opts.useWatermarked — si true, sirve desde watermarked/ (default: false)
 */
function streamProjectZip(res, project, photos, opts = {}) {
  const { useWatermarked = false } = opts
  const zipName = `${project.slug}-fotos.zip`

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`)

  const archive = archiver('zip', { zlib: { level: 6 } })

  archive.on('error', (err) => {
    console.error('Error generando ZIP:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al generar el ZIP' })
    }
  })

  archive.pipe(res)

  for (const photo of photos) {
    let filePath
    let archiveName

    if (useWatermarked) {
      // Nombre del watermarked es siempre stem + .png
      const stem = photo.filename.replace(/\.[^.]+$/, '')
      const watermarkedFile = photo.watermarked_filename || (stem + '.png')
      filePath = path.join(getWatermarkedDir(project.slug), watermarkedFile)
      // Nombre de descarga: original_name con extensión .png
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
}

module.exports = { streamProjectZip }
