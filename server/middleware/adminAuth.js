const jwt = require('jsonwebtoken')
const config = require('../config')

function adminAuth(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' })
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret)
    if (payload.role !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado' })
    }
    req.admin = payload
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesión expirada' })
    }
    return res.status(401).json({ error: 'Token inválido' })
  }
}

module.exports = adminAuth
