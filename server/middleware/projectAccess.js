const { getDb } = require('../db/database')

// Sesiones de acceso en memoria (slug -> timestamp)
// Simple y suficiente para un servidor personal
const accessSessions = new Map()
const SESSION_TTL = 60 * 60 * 1000 // 1 hora

function grantAccess(slug) {
  accessSessions.set(slug, Date.now())
}

function hasAccess(slug) {
  const ts = accessSessions.get(slug)
  if (!ts) return false
  if (Date.now() - ts > SESSION_TTL) {
    accessSessions.delete(slug)
    return false
  }
  return true
}

// Middleware: verifica que el proyecto existe y que el cliente tiene acceso
function projectAccess(req, res, next) {
  const { slug } = req.params
  const db = getDb()

  const project = db.prepare(
    'SELECT id, name, pin, is_active, code, cover_photo_id FROM projects WHERE slug = ?'
  ).get(slug)

  if (!project) {
    return res.status(404).json({ error: 'Proyecto no encontrado' })
  }

  if (!project.is_active) {
    return res.status(403).json({ error: 'Este proyecto no está disponible' })
  }

  // Sin PIN: acceso libre
  if (!project.pin) {
    req.project = project
    return next()
  }

  // Con PIN: verificar sesión o header
  if (hasAccess(slug)) {
    req.project = project
    return next()
  }

  return res.status(401).json({ error: 'PIN requerido', requiresPin: true })
}

module.exports = { projectAccess, grantAccess, hasAccess }
