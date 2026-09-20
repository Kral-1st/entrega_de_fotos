const express = require('express')
const multer = require('multer')
const path = require('path')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const slugify = require('slugify')
const { getDb } = require('../db/database')
const adminAuth = require('../middleware/adminAuth')
const { invalidateZipCache } = require('../utils/zip')
const fs = require('fs')

const {
  ensureProjectDirs,
  getImageMeta,
  getOriginalsDir,
  deleteProjectFiles,
  deletePhotoFiles
} = require('../utils/storage')
const config = require('../config')
const audit = require('../middleware/auditLog')

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
    destination: (req, file, cb) => {
      // Forzamos a que el archivo temporal se guarde en el mismo disco montado
      cb(null, '/mnt/almacenamiento/server/entrega_de_fotos/uploads/tmp');
    },
    filename: (req, file, cb) => {
      // Mantenemos tu lógica de nombres, pero aseguramos la extensión original si es necesario
      const ext = path.extname(file.originalname);
      cb(null, `upload_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    }
  }),
  limits: { fileSize: config.upload.maxFileSize },
  fileFilter: (req, file, cb) => {
    if (config.upload.allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`));
    }
  }
});

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
        'SELECT * FROM photos WHERE project_id = ? ORDER BY COALESCE(captured_at, created_at) ASC'
      ).all(project.id)

      const viewCount = db.prepare('SELECT COUNT(*) as c FROM gallery_views WHERE project_id = ?').get(project.id).c

      res.json({ project: { ...project, view_count: viewCount }, photos })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error obteniendo proyecto' })
  }
})

// POST /admin/projects
router.post('/projects', audit('crear_proyecto', 'project'), async (req, res) => {
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
    const pinHash = pin ? await bcrypt.hash(String(pin), 12) : null
    const result = db.prepare(`
    INSERT INTO projects (name, slug, client_name, description, pin, code)
    VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, slug, client_name, description || null, pinHash, code)

    ensureProjectDirs(slug)

    const project = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM photos WHERE project_id = p.id) as photo_count,
        (SELECT COUNT(*) FROM gallery_views WHERE project_id = p.id) as view_count
      FROM projects p
      WHERE p.id = ?
    `).get(result.lastInsertRowid)
    res.status(201).json({ project })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error creando proyecto' })
  }
})

// PUT /admin/projects/:id
router.put('/projects/:id', audit('actualizar_proyecto', 'project'), async (req, res) => {
  try {
    const { name, client_name, description, pin, is_active, watermark_enabled, visible_watermark_enabled } = req.body
    const db = getDb()

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id)
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

    const pinHash = pin !== undefined
      ? (pin ? await bcrypt.hash(String(pin), 12) : null)
      : project.pin

    const wmEnabled = watermark_enabled !== undefined ? (watermark_enabled ? 1 : 0) : project.watermark_enabled
    // Si el maestro se apaga, la firma visible se apaga con él, sin excepción (se valida aquí, no solo en el front)
    const visibleWmEnabled = wmEnabled === 0
      ? 0
      : (visible_watermark_enabled !== undefined ? (visible_watermark_enabled ? 1 : 0) : project.visible_watermark_enabled)

    db.prepare(`
      UPDATE projects
      SET name = ?, client_name = ?, description = ?, pin = ?, is_active = ?,
          watermark_enabled = ?, visible_watermark_enabled = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name ?? project.name,
      client_name ?? project.client_name,
      description !== undefined ? description : project.description,
      pinHash,
      is_active !== undefined ? (is_active ? 1 : 0) : project.is_active,
      wmEnabled,
      visibleWmEnabled,
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
router.delete('/projects/:id', audit('eliminar_proyecto', 'project'), (req, res) => {
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
router.post('/projects/:id/photos', upload.array('photos', 100), audit('subir_fotos', 'project'), async (req, res) => {
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

        // Mover directamente sin recomprimir — preserva el original intacto
        const fs = require('fs')
        fs.renameSync(file.path, originalPath)

        // Obtener dimensiones
        const meta = await getImageMeta(originalPath)

        // sharp no pudo leerlo como imagen real → mimetype falso, lo rechazamos
        if (!meta.width || !meta.height) {
          fs.unlinkSync(originalPath)
          errors.push({ file: file.originalname, error: 'El archivo no es una imagen válida' })
          continue
        }

        // Insertar con watermark_status = 'pending' — sin thumb/preview aún
        const result = db.prepare(`
          INSERT INTO photos (project_id, filename, original_name, size, width, height, watermark_status, captured_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(project.id, uniqueName, file.originalname, file.size, meta.width, meta.height, meta.capturedAt)

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

// ─── SUBIDA POR PARTES (chunks) ───────────────────────────────────────────────
// Cada POST lleva un pedazo de ≤25MB para no pasar el límite de 100MB por
// request de Cloudflare. Al llegar el último pedazo se arma la foto y se
// registra igual que en POST /projects/:id/photos.
const CHUNKS_DIR = path.join(config.paths.uploads, 'tmp', 'chunks')
const CHUNKS_INCOMING = path.join(CHUNKS_DIR, '_in')
const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic']

const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(CHUNKS_INCOMING, { recursive: true })
      cb(null, CHUNKS_INCOMING)
    },
    filename: (req, file, cb) => cb(null, `c_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  }),
  limits: { fileSize: 60 * 1024 * 1024 } // un pedazo (25MB) con margen
})

// Borra sesiones de chunks abandonadas (subida cancelada / pestaña cerrada)
function limpiarChunksViejos() {
  try {
    if (!fs.existsSync(CHUNKS_DIR)) return
      for (const name of fs.readdirSync(CHUNKS_DIR)) {
        const p = path.join(CHUNKS_DIR, name)
        if (Date.now() - fs.statSync(p).mtimeMs > 6 * 3600 * 1000) {
          fs.rmSync(p, { recursive: true, force: true })
        }
      }
  } catch (err) {
    console.error('Limpieza de chunks:', err.message)
  }
}
limpiarChunksViejos()
setInterval(limpiarChunksViejos, 3600 * 1000).unref()

// Auditar solo el último pedazo (una entrada por foto, no una por pedazo)
const auditFoto = audit('subir_fotos', 'project')
const auditSoloUltimo = (req, res, next) =>
Number(req.body.chunkIndex) === Number(req.body.totalChunks) - 1 ? auditFoto(req, res, next) : next()

// POST /admin/projects/:id/photos/chunk
router.post('/projects/:id/photos/chunk', chunkUpload.single('chunk'), auditSoloUltimo, async (req, res) => {
  const descartarPedazo = () => { if (req.file) fs.rmSync(req.file.path, { force: true }) }
  try {
    const db = getDb()
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id)
    if (!project) { descartarPedazo(); return res.status(404).json({ error: 'Proyecto no encontrado' }) }
    if (!req.file) return res.status(400).json({ error: 'No se recibió el pedazo' })

      const { uploadId } = req.body
      const filename = path.basename(String(req.body.filename || ''))
      const idx = Number(req.body.chunkIndex)
      const total = Number(req.body.totalChunks)
      const ext = path.extname(filename).toLowerCase()

      if (!/^[a-z0-9]{8,40}$/i.test(uploadId || '') || !filename ||
        !Number.isInteger(idx) || !Number.isInteger(total) || idx < 0 || idx >= total || total > 100) {
        descartarPedazo()
        return res.status(400).json({ error: 'Datos del pedazo inválidos' })
        }
        if (!ALLOWED_EXTS.includes(ext)) {
          descartarPedazo()
          return res.status(400).json({ error: `Tipo de archivo no permitido: ${ext || 'sin extensión'}` })
        }

        const sesion = path.join(CHUNKS_DIR, uploadId)
        fs.mkdirSync(sesion, { recursive: true })
        fs.renameSync(req.file.path, path.join(sesion, `${idx}.part`))

        if (idx < total - 1) return res.json({ completo: false, recibidos: idx + 1, total })

          // Último pedazo: verificar que estén todos y armar el archivo
          for (let i = 0; i < total; i++) {
            if (!fs.existsSync(path.join(sesion, `${i}.part`))) {
              return res.status(400).json({ error: `Falta el pedazo ${i}` })
            }
          }

          ensureProjectDirs(project.slug)
          const armado = path.join(CHUNKS_DIR, `${uploadId}${ext}`)
          for (let i = 0; i < total; i++) {
            await fs.promises.appendFile(armado, await fs.promises.readFile(path.join(sesion, `${i}.part`)))
          }
          fs.rmSync(sesion, { recursive: true, force: true })

          const size = fs.statSync(armado).size
          if (size > config.upload.maxFileSize) {
            fs.rmSync(armado, { force: true })
            return res.status(413).json({ error: 'La foto excede el tamaño máximo' })
          }

          const uniqueName = `${crypto.randomBytes(8).toString('hex')}${ext}`
          const originalPath = path.join(getOriginalsDir(project.slug), uniqueName)
          fs.renameSync(armado, originalPath)

          const meta = await getImageMeta(originalPath)
          if (!meta.width || !meta.height) {
            fs.unlinkSync(originalPath)
            return res.status(400).json({ error: 'El archivo no es una imagen válida' })
          }

          const result = db.prepare(`
          INSERT INTO photos (project_id, filename, original_name, size, width, height, watermark_status, captured_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
          `).run(project.id, uniqueName, filename, size, meta.width, meta.height, meta.capturedAt)

          res.status(201).json({
            completo: true,
            uploaded: 1,
            photos: [{ id: result.lastInsertRowid, filename: uniqueName, original_name: filename }]
          })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error subiendo el pedazo' })
  }
})

// DELETE /admin/photos/:photoId
router.delete('/photos/:photoId', audit('eliminar_foto', 'photo'), (req, res) => {
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
    invalidateZipCache(photo.slug)

    res.json({ message: 'Foto eliminada' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error eliminando foto' })
  }
})
// DELETE /admin/projects/:id/photos — borra TODAS las fotos, conserva el proyecto
router.delete('/projects/:id/photos', audit('eliminar_todas_fotos', 'project'), (req, res) => {
  try {
    const db = getDb()
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id)
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

      const count = db.prepare('SELECT COUNT(*) as c FROM photos WHERE project_id = ?').get(project.id).c

      db.prepare('DELETE FROM photos WHERE project_id = ?').run(project.id)
      db.prepare("UPDATE projects SET cover_photo_id = NULL, updated_at = datetime('now') WHERE id = ?").run(project.id)

      deleteProjectFiles(project.slug)
      ensureProjectDirs(project.slug)

      res.json({ message: 'Fotos eliminadas', deleted: count })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error eliminando fotos' })
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
router.put('/projects/:id/cover', audit('cambiar_cover', 'project'), (req, res) => {
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
// GET /admin/audit-log
router.get('/audit-log', (req, res) => {
  try {
    const db = getDb()
    const logs = db.prepare(
      'SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 200'
    ).all()
    res.json({ logs })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error obteniendo logs' })
  }
})

module.exports = router
