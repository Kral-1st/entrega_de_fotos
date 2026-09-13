require('dotenv').config()
const path = require('path')

module.exports = {
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV,

  domains: {
    api: process.env.API_DOMAIN || 'http://localhost:3000',
    frontend: process.env.FRONTEND_DOMAIN || 'http://localhost:5500'
  },

  contact: {
    whatsapp: process.env.CONTACT_WHATSAPP,
    email: process.env.CONTACT_EMAIL,
    instagram: process.env.CONTACT_INSTAGRAM,
    domain: process.env.PUBLIC_DOMAIN
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    gallerySecret: process.env.GALLERY_JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  },

  admin: {
    password: process.env.ADMIN_PASSWORD
  },

  worker: {
    secret: process.env.WM_WORKER_SECRET
  },

  paths: {
    uploads: process.env.UPLOADS_PATH || path.join(__dirname, '../../uploads'),
    db: process.env.DB_PATH || path.join(__dirname, 'db/database.sqlite')
  },

  upload: {
    maxFileSize: 200 * 1024 * 1024, // 200MB por foto
    allowedMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/heic'],
    thumbWidth: 400,
    previewWidth: 1200,
    previewQuality: 80,
    thumbQuality: 75
  },

  notify: {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
    vapidSubject: process.env.VAPID_SUBJECT || '',
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    smtpFrom: process.env.SMTP_FROM || ''
  }
}
// ─── Fail-fast: sin estos secretos, JWT/PIN/worker quedan forjables ───────────
const required = {
  JWT_SECRET: process.env.JWT_SECRET,
  GALLERY_JWT_SECRET: process.env.GALLERY_JWT_SECRET,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  WM_WORKER_SECRET: process.env.WM_WORKER_SECRET
}
const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k)
if (missing.length > 0) {
  throw new Error(`Faltan variables de entorno críticas: ${missing.join(', ')}`)
}
