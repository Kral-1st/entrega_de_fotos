const express = require('express')
const path = require('path')
const fs = require('fs')
const { getDb } = require('../db/database')
const { projectAccess, grantAccess } = require('../middleware/projectAccess')
const { getOriginalsDir, getWatermarkedDir, getThumbsDir, getPreviewsDir } = require('../utils/storage')
const { streamProjectZip } = require('../utils/zip')
const config = require('../config')

const router = express.Router()

// GET /gallery/code/:code — buscar proyecto por código (público)
router.get('/code/:code', (req, res) => {
  try {
    const db = getDb()
    const project = db.prepare(
      'SELECT slug, name, is_active FROM projects WHERE code = ?'
    ).get(req.params.code.toUpperCase())

    if (!project) return res.status(404).json({ error: 'Código no válido' })
    if (!project.is_active) return res.status(403).json({ error: 'Galería no disponible' })

    res.json({ slug: project.slug, name: project.name })
  } catch (err) {
    res.status(500).json({ error: 'Error interno' })
  }
})

// POST /gallery/:slug/unlock — verificar PIN
router.post('/:slug/unlock', (req, res) => {
  try {
    const { slug } = req.params
    const { pin } = req.body
    const db = getDb()

    const project = db.prepare(
      'SELECT id, name, pin, is_active FROM projects WHERE slug = ?'
    ).get(slug)

    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
    if (!project.is_active) return res.status(403).json({ error: 'Proyecto no disponible' })

    if (!project.pin) {
      return res.json({ success: true, message: 'Sin PIN requerido' })
    }

    if (project.pin !== pin) {
      return res.status(401).json({ error: 'PIN incorrecto' })
    }

    grantAccess(slug)
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error interno' })
  }
})

// GET /gallery/:slug — info del proyecto + lista de fotos
// Solo devuelve fotos con watermark_status = 'done'
router.get('/:slug', projectAccess, (req, res) => {
  try {
    const db = getDb()
    const { session_id } = req.query
    const { project } = req

    const photos = db.prepare(`
      SELECT id, filename, original_name, size, width, height, created_at
      FROM photos
      WHERE project_id = ? AND watermark_status = 'done'
      ORDER BY created_at ASC
    `).all(project.id)

    const baseApi = config.domains.api

    const likeCounts = db.prepare(`
      SELECT photo_id, COUNT(*) as c FROM likes
      WHERE photo_id IN (SELECT id FROM photos WHERE project_id = ?)
      GROUP BY photo_id
    `).all(project.id).reduce((acc, r) => { acc[r.photo_id] = r.c; return acc }, {})

    const sessionLikes = session_id
      ? db.prepare(`
          SELECT photo_id FROM likes
          WHERE session_id = ?
          AND photo_id IN (SELECT id FROM photos WHERE project_id = ?)
        `).all(session_id, project.id).reduce((acc, r) => { acc[r.photo_id] = true; return acc }, {})
      : {}

    const photosWithUrls = photos.map(p => ({
      ...p,
      thumb_url: `${baseApi}/gallery/${req.params.slug}/thumb/${p.filename.replace(/\.[^.]+$/, '.jpg')}`,
      original_url: `${baseApi}/gallery/${req.params.slug}/original/${p.filename}`,
      preview_url: `${baseApi}/gallery/${req.params.slug}/preview/${p.filename.replace(/\.[^.]+$/, '.jpg')}`,
      like_count: likeCounts[p.id] || 0,
      liked: !!sessionLikes[p.id]
    }))

    let cover_url = null
    if (project.cover_photo_id) {
      // cover debe estar procesada para mostrarse
      const cover = photos.find(p => p.id == project.cover_photo_id)
      if (cover) cover_url = `${baseApi}/gallery/${req.params.slug}/thumb/${cover.filename.replace(/\.[^.]+$/, '.jpg')}`
    }
    if (!cover_url && photos.length > 0) {
      cover_url = `${baseApi}/gallery/${req.params.slug}/thumb/${photos[0].filename.replace(/\.[^.]+$/, '.jpg')}`
    }

    res.json({
      project: {
        id: project.id,
        name: project.name,
        slug: req.params.slug,
        code: project.code,
        photo_count: photos.length,
        cover_url
      },
      photos: photosWithUrls
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error obteniendo galería' })
  }
})

// GET /gallery/:slug/thumb/:filename — servir thumbnail
router.get('/:slug/thumb/:filename', projectAccess, (req, res) => {
  const { slug, filename } = req.params
  const thumbPath = path.join(getThumbsDir(slug), filename)

  if (!fs.existsSync(thumbPath)) {
    return res.status(404).json({ error: 'Imagen no encontrada' })
  }

  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.sendFile(thumbPath)
})

// GET /gallery/:slug/original/:filename — descarga desde watermarked/
router.get('/:slug/original/:filename', projectAccess, (req, res) => {
  const { slug, filename } = req.params
  const safeName = path.basename(filename)
  const db = getDb()

  // Buscar foto en DB para obtener watermarked_filename
  const photo = db.prepare(
    'SELECT original_name, watermarked_filename FROM photos WHERE filename = ? AND watermark_status = \'done\''
  ).get(safeName)

  if (!photo) return res.status(404).json({ error: 'Imagen no disponible' })

  // watermarked_filename es el stem + .png; si por alguna razón no existe, no hay fallback al original
  const watermarkedFile = photo.watermarked_filename || safeName.replace(/\.[^.]+$/, '.png')
  const watermarkedPath = path.join(getWatermarkedDir(slug), watermarkedFile)

  if (!fs.existsSync(watermarkedPath)) {
    return res.status(404).json({ error: 'Imagen no encontrada' })
  }

  const downloadName = photo.original_name
    ? photo.original_name.replace(/\.[^.]+$/, '.png')
    : watermarkedFile

  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.sendFile(watermarkedPath)
})

// GET /gallery/:slug/preview/:filename — servir preview
router.get('/:slug/preview/:filename', projectAccess, (req, res) => {
  const { slug, filename } = req.params
  const previewPath = path.join(getPreviewsDir(slug), filename)

  if (!fs.existsSync(previewPath)) {
    // Fallback al original si no existe preview (no debería pasar en fotos nuevas)
    const originalPath = path.join(getOriginalsDir(slug), filename)
    if (!fs.existsSync(originalPath)) return res.status(404).json({ error: 'Imagen no encontrada' })
    res.setHeader('Cache-Control', 'public, max-age=86400')
    return res.sendFile(originalPath)
  }

  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.sendFile(previewPath)
})

// GET /gallery/:slug/download — ZIP desde watermarked/
router.get('/:slug/download', projectAccess, (req, res) => {
  try {
    const db = getDb()
    const { project } = req

    const photos = db.prepare(
      'SELECT * FROM photos WHERE project_id = ? AND watermark_status = \'done\' ORDER BY created_at ASC'
    ).all(project.id)

    if (photos.length === 0) {
      return res.status(404).json({ error: 'No hay fotos disponibles' })
    }

    // Pasar flag para que zip.js sepa que debe servir desde watermarked/
    streamProjectZip(res, { slug: req.params.slug, ...project }, photos, { useWatermarked: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error generando descarga' })
  }
})

module.exports = router

// POST /gallery/:slug/likes/:photoId — toggle like
router.post('/:slug/likes/:photoId', projectAccess, (req, res) => {
  try {
    const { photoId } = req.params
    const { session_id } = req.body
    if (!session_id) return res.status(400).json({ error: 'session_id requerido' })

    const db = getDb()
    const photo = db.prepare('SELECT id FROM photos WHERE id = ? AND project_id = ?')
      .get(photoId, req.project.id)
    if (!photo) return res.status(404).json({ error: 'Foto no encontrada' })

    const existing = db.prepare('SELECT id FROM likes WHERE photo_id = ? AND session_id = ?')
      .get(photoId, session_id)

    if (existing) {
      db.prepare('DELETE FROM likes WHERE photo_id = ? AND session_id = ?')
        .run(photoId, session_id)
      const count = db.prepare('SELECT COUNT(*) as c FROM likes WHERE photo_id = ?').get(photoId).c
      return res.json({ liked: false, count })
    } else {
      db.prepare('INSERT INTO likes (photo_id, session_id) VALUES (?, ?)').run(photoId, session_id)
      const count = db.prepare('SELECT COUNT(*) as c FROM likes WHERE photo_id = ?').get(photoId).c
      return res.json({ liked: true, count })
    }
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error procesando like' })
  }
})
