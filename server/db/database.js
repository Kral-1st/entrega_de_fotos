const Database = require('better-sqlite3')
const fs = require('fs')
const path = require('path')
const bcrypt = require('bcryptjs')
const config = require('../config')

let db

function getDb() {
  if (!db) {
    throw new Error('Base de datos no inicializada. Llama initDb() primero.')
  }
  return db
}

async function initDb() {
  // Asegurar que el directorio existe
  const dbDir = path.dirname(config.paths.db)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  db = new Database(config.paths.db)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Ejecutar schema
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
  db.exec(schema)

  // Crear admin por defecto si no existe
  const admin = db.prepare('SELECT id FROM admin WHERE id = 1').get()
  if (!admin) {
    const hash = await bcrypt.hash(config.admin.password, 12)
    db.prepare('INSERT INTO admin (id, password_hash) VALUES (1, ?)').run(hash)
    console.log('✓ Admin creado con la contraseña del .env')
  }

  console.log('✓ Base de datos inicializada:', config.paths.db)
  return db
}

module.exports = { getDb, initDb }
