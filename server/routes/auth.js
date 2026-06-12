const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const rateLimit = require('express-rate-limit')
const { getDb } = require('../db/database')
const config = require('../config')

const router = express.Router()

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  message: { error: 'Demasiados intentos. Espera 15 minutos.' }
})

// POST /auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { password } = req.body

    if (!password) {
      return res.status(400).json({ error: 'Contraseña requerida' })
    }

    const db = getDb()
    const admin = db.prepare('SELECT password_hash FROM admin WHERE id = 1').get()

    if (!admin) {
      return res.status(500).json({ error: 'Admin no configurado' })
    }

    const valid = await bcrypt.compare(password, admin.password_hash)

    if (!valid) {
      return res.status(401).json({ error: 'Contraseña incorrecta' })
    }

    const token = jwt.sign(
      { role: 'admin', id: 1 },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    )

    res.json({ token, expiresIn: config.jwt.expiresIn })
  } catch (err) {
    console.error('Error en login:', err)
    res.status(500).json({ error: 'Error interno' })
  }
})

// GET /auth/verify - para verificar si el token sigue válido
router.get('/verify', (req, res) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ valid: false })
  }

  try {
    jwt.verify(token, config.jwt.secret)
    res.json({ valid: true })
  } catch {
    res.status(401).json({ valid: false })
  }
})

module.exports = router
