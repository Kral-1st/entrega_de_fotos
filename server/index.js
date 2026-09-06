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
const workerRoutes = require('./routes/worker')
const cookieParser = require('cookie-parser')
const rateLimit = require('express-rate-limit')

const app = express()
app.set('trust proxy', 1)

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [config.domains.frontend, process.env.CORS1, process.env.CORS2],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}))

app.use(cookieParser())

// ─── BODY PARSING ─────────────────────────────────────────────────────────────
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ─── RATE LIMIT GLOBAL ─────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta de nuevo en unos minutos.' },
  // /internal/worker se salta: el polling legítimo de los workers de watermark
  // dispara muchísimas peticiones por diseño. /admin se salta: ya está detrás
  // de JWT, y el polling de estado durante un batch largo puede acumular
  // cientos de requests sin ser abuso.
  skip: (req) => {
    if (req.path.startsWith('/internal/worker') || req.path.startsWith('/admin')) return true
      // Servir thumb/preview/original escala con la cantidad de fotos del
      // proyecto, no es un vector de abuso — /download y /unlock ya tienen
      // sus propios límites, más estrictos, específicos para eso.
      if (/^\/gallery\/[^/]+\/(thumb|preview|original)\//.test(req.path)) return true
        return false
  }
})

app.use(globalLimiter)

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
app.use('/internal/worker', workerRoutes)
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
