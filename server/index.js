require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const { initDb } = require('./db/database')
const config = require('./config')
const authRoutes = require('./routes/auth')
const adminRoutes = require('./routes/admin')
const galleryRoutes = require('./routes/gallery')
const portfolioRoutes = require('./routes/portfolio')
const { router: processingRoutes, resumeInterruptedBatches } = require('./routes/processing')

const app = express()
app.set('trust proxy', 1)

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [config.domains.frontend, 'http://100.91.125.114:8081', 'http://server:8081'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}))

// ─── BODY PARSING ─────────────────────────────────────────────────────────────
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ─── LOGGING BÁSICO ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const ts = new Date().toISOString()
  console.log(`[${ts}] ${req.method} ${req.path}`)
  next()
})

// ─── Thumbs del admin — auth por query token ──────────────────────────────────
const adminAuth = require('./middleware/adminAuth')
app.get('/admin/thumb/:slug/:filename', (req, res, next) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`
  }
  next()
}, adminAuth, (req, res) => {
  const fs = require('fs')
  const { getThumbsDir } = require('./utils/storage')
  const { slug, filename } = req.params
  const safeName = path.basename(filename)
  const thumbPath = path.join(getThumbsDir(slug), safeName)
  if (!fs.existsSync(thumbPath)) {
    return res.status(404).json({ error: 'Thumbnail no encontrado' })
  }
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.sendFile(thumbPath)
})

// ─── RUTAS ────────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes)
app.use('/admin', adminRoutes)
app.use('/admin/process', processingRoutes)
app.use('/gallery', galleryRoutes)
app.use('/portfolio', portfolioRoutes)

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
})

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' })
})

// Error handler global
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err)
  res.status(500).json({ error: 'Error interno del servidor' })
})

// ─── INICIO ───────────────────────────────────────────────────────────────────
async function start() {
  try {
    await initDb()
    app.listen(config.port, () => {
      console.log(`\n🚀 API corriendo en puerto ${config.port}`)
      console.log(`   API pública:  ${config.domains.api}`)
      console.log(`   Frontend:     ${config.domains.frontend}`)
      console.log(`   Entorno:      ${config.nodeEnv}\n`)
    })
    resumeInterruptedBatches()
  } catch (err) {
    console.error('Error iniciando servidor:', err)
    process.exit(1)
  }
}
start()
