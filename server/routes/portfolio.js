const express = require('express')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const multer = require('multer')
const sharp = require('sharp')
const { getDb } = require('../db/database')
const adminAuth = require('../middleware/adminAuth')
const config = require('../config')

const router = express.Router()

// Misma estructura que uploads/[slug]/, sin watermarked porque acá no aplica
const PORTFOLIO_DIR = path.join(config.paths.uploads, '_portfolio')
const ORIGINALS_DIR = path.join(PORTFOLIO_DIR, 'originals')
const PREVIEWS_DIR = path.join(PORTFOLIO_DIR, 'previews')
const THUMBS_DIR = path.join(PORTFOLIO_DIR, 'thumbs')

function ensurePortfolioDirs() {
  for (const dir of [ORIGINALS_DIR, PREVIEWS_DIR, THUMBS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { ensurePortfolioDirs(); cb(null, require('os').tmpdir()) },
    filename: (req, file, cb) => cb(null, `portfolio_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    ['image/jpeg','image/png','image/webp'].includes(file.mimetype) ? cb(null, true) : cb(new Error('Tipo no permitido'))
  }
})

router.get('/', (req, res) => {
  try {
    const db = getDb()
    const items = db.prepare('SELECT * FROM portfolio ORDER BY sort_order ASC, created_at ASC').all()
    res.json({
      portfolio: items.map(i => ({
        ...i,
        url: `${config.domains.api}/portfolio/preview/${i.filename}`,
        thumb_url: `${config.domains.api}/portfolio/thumb/${i.filename}`
      }))
    })
  } catch (err) { res.status(500).json({ error: 'Error obteniendo portafolio' }) }
})

router.get('/preview/:filename', (req, res) => {
  const filePath = path.join(PREVIEWS_DIR, path.basename(req.params.filename))
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'No encontrada' })
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.sendFile(filePath)
})

router.get('/thumb/:filename', (req, res) => {
  const filePath = path.join(THUMBS_DIR, path.basename(req.params.filename))
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'No encontrada' })
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.sendFile(filePath)
})

router.post('/', adminAuth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' })
    ensurePortfolioDirs()
    const filename = `${crypto.randomBytes(8).toString('hex')}.jpg`

    const originalPath = path.join(ORIGINALS_DIR, filename)
    const previewPath = path.join(PREVIEWS_DIR, filename)
    const thumbPath = path.join(THUMBS_DIR, filename)

    // original: copia maestra normalizada (rotada), tope de resolución razonable
    await sharp(req.file.path).rotate().resize(2400, null, { withoutEnlargement: true, fit: 'inside' }).jpeg({ quality: 92 }).toFile(originalPath)
    // preview: fondo del hero y lightbox
    await sharp(req.file.path).rotate().resize(config.upload.previewWidth, null, { withoutEnlargement: true, fit: 'inside' }).jpeg({ quality: config.upload.previewQuality }).toFile(previewPath)
    // thumb: cuadrícula del portafolio
    await sharp(req.file.path).rotate().resize(config.upload.thumbWidth, null, { withoutEnlargement: true, fit: 'inside' }).jpeg({ quality: config.upload.thumbQuality }).toFile(thumbPath)

    fs.unlinkSync(req.file.path)
    const db = getDb()
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM portfolio').get()
    const nextOrder = (maxOrder.m ?? -1) + 1
    const result = db.prepare('INSERT INTO portfolio (filename, sort_order) VALUES (?, ?)').run(filename, nextOrder)
    res.status(201).json({
      item: {
        id: result.lastInsertRowid,
        filename,
        sort_order: nextOrder,
        url: `${config.domains.api}/portfolio/preview/${filename}`,
        thumb_url: `${config.domains.api}/portfolio/thumb/${filename}`
      }
    })
  } catch (err) {
    console.error(err)
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
      res.status(500).json({ error: 'Error subiendo imagen' })
  }
})

router.delete('/:id', adminAuth, (req, res) => {
  try {
    const db = getDb()
    const item = db.prepare('SELECT * FROM portfolio WHERE id = ?').get(req.params.id)
    if (!item) return res.status(404).json({ error: 'No encontrada' })
    db.prepare('DELETE FROM portfolio WHERE id = ?').run(item.id)
    for (const dir of [ORIGINALS_DIR, PREVIEWS_DIR, THUMBS_DIR]) {
      const filePath = path.join(dir, item.filename)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }
    res.json({ message: 'Eliminada' })
  } catch (err) { res.status(500).json({ error: 'Error eliminando' }) }
})

router.put('/order', adminAuth, (req, res) => {
  try {
    const { order } = req.body
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order debe ser array de ids' })
    const db = getDb()
    const update = db.prepare('UPDATE portfolio SET sort_order = ? WHERE id = ?')
    order.forEach((id, i) => update.run(i, id))
    res.json({ message: 'Orden actualizado' })
  } catch (err) { res.status(500).json({ error: 'Error actualizando orden' }) }
})

module.exports = router
