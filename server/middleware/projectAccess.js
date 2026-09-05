const jwt = require('jsonwebtoken')
const { getDb } = require('../db/database')
const config = require('../config')

const ACCESS_TTL = '2h'

// Genera un token de acceso firmado, ligado a ESTE slug específico.
function grantAccess(slug) {
  return jwt.sign({ slug }, config.jwt.secret, { expiresIn: ACCESS_TTL })
}

// Middleware: verifica que el proyecto existe y que ESTE cliente tiene acceso
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

  // Con PIN: verificar la cookie de acceso de ESTE cliente para ESTE slug
  const token = req.cookies && req.cookies[`gallery_access_${slug}`]
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwt.secret)
      if (payload.slug === slug) {
        req.project = project
        return next()
      }
    } catch {
      // token inválido o vencido — cae al 401 de abajo
    }
  }

  return res.status(401).json({ error: 'PIN requerido', requiresPin: true })
}

module.exports = { projectAccess, grantAccess }
