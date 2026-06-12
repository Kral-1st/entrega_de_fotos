const express = require('express')
const multer = require('multer')
const path = require('path')
const crypto = require('crypto')
const slugify = require('slugify')
const { getDb } = require('../db/database')
const adminAuth = require('../middleware/adminAuth')
const {
  ensureProjectDirs,
  getImageMeta,
  getOriginalsDir,
  deleteProjectFiles,
  deletePhotoFiles
} = require('../utils/storage')
const config = require('../config')

// Generar código único de 6 letras para el proyecto
function generateCode(db) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code, exists
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    exists = db.prepare('SELECT id FROM projects WHERE code = ?').get(code)
  } while (exists)
  return code
}

const router = express.Router()

// Todas las rutas de admin requieren JWT
router.use(adminAuth)

// Multer: guarda en tmpdir, luego lo movemos a originals/
const os = require('os')
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `upload_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  }),
  limits: { fileSize: config.upload.maxFileSize },
  fileFilter: (req, file, cb) => {
    if (config.upload.allowedMimes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`))
    }
  }
})

// ─── PROYECTOS ────────────────────────────────────────────────────────────────

// GET /admin/projects
router.get('/projects', (req, res) => {
  try {
    const db = getDb()
    const projects = db.prepare(`
      SELECT p.*, COUNT(ph.id) as photo_count
      FROM projects p
      LEFT JOIN photos ph ON ph.project_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `).all()

    res.json({ projects })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error obteniendo proyectos' })
  }
})

// GET /admin/projects/:id
router.get('/projects/:id', (req, res) => {
  try {
    const db = getDb()
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id)

    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

    const photos = db.prepare(
      'SELECT * FROM photos WHERE project_id = ? ORDER BY created_at ASC'
    ).all(project.id)

    res.json({ project, photos })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error obteniendo proyecto' })
  }
})

// POST /admin/projects
router.post('/projects', (req, res) => {
  try {
    const { name, client_name, description, pin } = req.body

    if (!name || !client_name) {
      return res.status(400).json({ error: 'Nombre y cliente son requeridos' })
    }

    const db = getDb()

    let baseSlug = slugify(name, { lower: true, strict: true })
    let slug = baseSlug
    let counter = 1

    while (db.prepare('SELECT id FROM projects WHERE slug = ?').get(slug)) {
      slug = `${baseSlug}-${counter++}`
    }

    const code = generateCode(db)
    const result = db.prepare(`
      INSERT INTO projects (name, slug, client_name, description, pin, code)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, slug, client_name, description || null, pin || null, code)

    ensureProjectDirs(slug)

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ project })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error creando proyecto' })
  }
})

// PUT /admin/projects/:id
router.put('/projects/:id', (req, res) => {
  try {
    const { name, client_name, description, pin, is_active } = req.body
    const db = getDb()

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id)
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

    db.prepare(`
      UPDATE projects
      SET name = ?, client_name = ?, description = ?, pin = ?, is_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name ?? project.name,
      client_name ?? project.client_name,
      description !== undefined ? description : project.description,
      pin !== undefined ? (pin || null) : project.pin,
      is_active !== undefined ? (is_active ? 1 : 0) : project.is_active,
      project.id
    )

    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id)
    res.json({ project: updated })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error actualizando proyecto' })
  }
})

// DELETE /admin/projects/:id
router.delete('/projects/:id', (req, res) => {
  try {
    const db = getDb()
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id)

    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

    db.prepare('DELETE FROM projects WHERE id = ?').run(project.id)
    deleteProjectFiles(project.slug)

    res.json({ message: 'Proyecto eliminado' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error eliminando proyecto' })
  }
})

// ─── FOTOS ────────────────────────────────────────────────────────────────────

// POST /admin/projects/:id/photos — upload, guarda en originals/, status pending
router.post('/projects/:id/photos', upload.array('photos', 100), async (req, res) => {
  try {
    const db = getDb()
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id)

    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se recibieron archivos' })
    }

    ensureProjectDirs(project.slug)

    const fs = require('fs')
    const sharp = require('sharp')
    const inserted = []
    const errors = []

    for (const file of req.files) {
      try {
        const ext = path.extname(file.originalname).toLowerCase()
        const uniqueName = `${crypto.randomBytes(8).toString('hex')}${ext}`
        const originalPath = path.join(getOriginalsDir(project.slug), uniqueName)

        // Guardar en originals/ rotando según EXIF, sin más procesamiento
        await sharp(file.path)
          .rotate()
          .toFile(originalPath)

        // Obtener dimensiones
        const meta = await getImageMeta(originalPath)

        fs.unlinkSync(file.path)

        // Insertar con watermark_status = 'pending' — sin thumb/preview aún
        const result = db.prepare(`
          INSERT INTO photos (project_id, filename, original_name, size, width, height, watermark_status)
          VALUES (?, ?, ?, ?, ?, ?, 'pending')
        `).run(project.id, uniqueName, file.originalname, file.size, meta.width, meta.height)

        inserted.push({
          id: result.lastInsertRowid,
          filename: uniqueName,
          original_name: file.originalname
        })
      } catch (fileErr) {
        console.error(`Error procesando ${file.originalname}:`, fileErr)
        errors.push({ file: file.originalname, error: fileErr.message })
      }
    }

    res.status(201).json({
      uploaded: inserted.length,
      errors: errors.length > 0 ? errors : undefined,
      photos: inserted
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error subiendo fotos' })
  }
})

// DELETE /admin/photos/:photoId
router.delete('/photos/:photoId', (req, res) => {
  try {
    const db = getDb()
    const photo = db.prepare(`
      SELECT ph.*, p.slug FROM photos ph
      JOIN projects p ON p.id = ph.project_id
      WHERE ph.id = ?
    `).get(req.params.photoId)

    if (!photo) return res.status(404).json({ error: 'Foto no encontrada' })

    db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id)
    deletePhotoFiles(photo.slug, photo.filename)

    res.json({ message: 'Foto eliminada' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error eliminando foto' })
  }
})

// Manejo de errores de multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Archivo muy grande. Máximo 50MB por foto.' })
    }
    return res.status(400).json({ error: err.message })
  }
  if (err) {
    return res.status(400).json({ error: err.message })
  }
  next()
})

// PUT /admin/projects/:id/cover
router.put('/projects/:id/cover', (req, res) => {
  try {
    const { photo_id } = req.body
    const db = getDb()
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id)
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

    if (photo_id) {
      const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND project_id = ?').get(photo_id, project.id)
      if (!photo) return res.status(404).json({ error: 'Foto no encontrada en este proyecto' })
    }

    db.prepare("UPDATE projects SET cover_photo_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(photo_id || null, project.id)

    res.json({ success: true, cover_photo_id: photo_id || null })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error actualizando cover' })
  }
})

module.exports = router
