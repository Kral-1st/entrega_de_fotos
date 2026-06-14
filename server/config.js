require('dotenv').config()
const path = require('path')

module.exports = {
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  domains: {
    api: process.env.API_DOMAIN || 'http://localhost:3000',
    frontend: process.env.FRONTEND_DOMAIN || 'http://localhost:5500'
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_in_production',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  },

  admin: {
    password: process.env.ADMIN_PASSWORD || 'admin123'
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
  }
}
