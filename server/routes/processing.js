// server/routes/processing.js
const express   = require('express')
const router    = express.Router()
const adminAuth = require('../middleware/adminAuth')
const { getDb } = require('../db/database')
const { processBatch } = require('../utils/watermark')

const processingLock = new Map()

// GET /admin/process/status/:slug
router.get('/status/:slug', adminAuth, (req, res) => {
  const { slug } = req.params
  const db = getDb()

  const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(slug)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

    const row = db.prepare(`
    SELECT
    COUNT(*)                                                          AS total,
                           SUM(CASE WHEN watermark_status = 'pending'    THEN 1 ELSE 0 END) AS pending,
                           SUM(CASE WHEN watermark_status = 'processing' THEN 1 ELSE 0 END) AS processing,
                           SUM(CASE WHEN watermark_status = 'done'       THEN 1 ELSE 0 END) AS done,
                           SUM(CASE WHEN watermark_status = 'error'      THEN 1 ELSE 0 END) AS error
                           FROM photos
                           WHERE project_id = ?
                           `).get(project.id)

                           res.json({ ...row, isProcessing: processingLock.has(slug) })
})

// POST /admin/process/:slug
router.post('/:slug', adminAuth, async (req, res) => {
  const { slug } = req.params
  const db = getDb()
  const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(slug)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

    if (processingLock.has(slug)) {
      return res.status(409).json({ error: 'Ya se está procesando este proyecto' })
    }

    const pending = db.prepare(`
    SELECT id FROM photos
    WHERE project_id = ? AND watermark_status = 'pending'
    `).all(project.id)

    if (pending.length === 0) {
      return res.json({ started: false, count: 0, message: 'No hay fotos pendientes' })
    }

    res.json({ started: true, count: pending.length })
    runBatch(slug, project.id)
})

async function runBatch(slug, projectId) {
  const db = getDb()

  // Limpiar PNGs corruptos y resetear 'processing' a 'pending'
  db.prepare(`
  UPDATE photos SET watermark_status = 'pending'
  WHERE project_id = ? AND watermark_status = 'processing'
  `).run(projectId)

  const pending = db.prepare(`
  SELECT id, filename FROM photos
  WHERE project_id = ? AND watermark_status = 'pending'
  ORDER BY created_at ASC
  `).all(projectId)

  if (pending.length === 0) return

    const { getWatermarkedDir } = require('../utils/storage')
    const fs   = require('fs')
    const path = require('path')

    // Borrar PNGs incompletos que pudieron quedar a medias
    for (const photo of pending) {
      const stem   = path.parse(photo.filename).name
      const pngPath = path.join(getWatermarkedDir(slug), stem + '.png')
      if (fs.existsSync(pngPath)) {
        fs.unlinkSync(pngPath)
        console.log(`[recovery] PNG corrupto eliminado: ${photo.filename}`)
      }
    }

    const ids = pending.map(p => p.id)
    db.prepare(`
    UPDATE photos SET watermark_status = 'processing'
    WHERE id IN (${ids.map(() => '?').join(',')})
    `).run(...ids)

    processingLock.set(slug, true)

    processBatch(slug, pending, (result) => {
      if (result.error) {
        db.prepare(`UPDATE photos SET watermark_status = 'error' WHERE id = ?`)
        .run(result.id)
      } else {
        db.prepare(`UPDATE photos SET watermark_status = 'done', watermarked_filename = ? WHERE id = ?`)
        .run(result.watermarkedFilename, result.id)
      }
    })
    .then(results => {
      const ok = results.filter(r => !r.error).length
      console.log(`[processing] ${slug}: ${ok}/${results.length} OK`)
    })
    .catch(err => {
      console.error(`[processing] Error fatal en batch ${slug}:`, err)
      db.prepare(`
      UPDATE photos SET watermark_status = 'error'
      WHERE project_id = ? AND watermark_status = 'processing'
      `).run(projectId)
    })
    .finally(() => {
      processingLock.delete(slug)
    })
}

async function resumeInterruptedBatches() {
  const db = getDb()
  const proyectos = db.prepare(`
  SELECT DISTINCT p.id, p.slug
  FROM photos ph
  JOIN projects p ON p.id = ph.project_id
  WHERE ph.watermark_status IN ('pending', 'processing')
  `).all()

  if (proyectos.length === 0) {
    console.log('[recovery] Sin batches interrumpidos')
    return
  }

  for (const { id, slug } of proyectos) {
    console.log(`[recovery] Reanudando batch interrumpido: ${slug}`)
    await runBatch(slug, id)
  }
}

module.exports = { router, resumeInterruptedBatches }
