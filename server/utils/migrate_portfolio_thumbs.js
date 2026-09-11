#!/usr/bin/env node
// server/utils/migrate_portfolio_thumbs.js
// Genera el _thumb.jpg de las fotos del portafolio que se subieron ANTES
// de que existiera el tamaño thumb (solo tenían el tamaño preview/1600px).
// No toca nada si el thumb ya existe.
//
// Uso: node server/utils/migrate_portfolio_thumbs.js

const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const PORTFOLIO_DIR = path.join(__dirname, '../../uploads/_portfolio')

async function main() {
  if (!fs.existsSync(PORTFOLIO_DIR)) {
    console.log('[INFO] No existe uploads/_portfolio, nada que migrar.')
    return
  }

  const files = fs.readdirSync(PORTFOLIO_DIR)
    .filter(f => f.endsWith('.jpg') && !f.endsWith('_thumb.jpg'))

  if (files.length === 0) {
    console.log('[INFO] No hay fotos de portafolio, nada que migrar.')
    return
  }

  let created = 0
  for (const file of files) {
    const thumbName = file.replace(/\.jpg$/, '_thumb.jpg')
    const thumbPath = path.join(PORTFOLIO_DIR, thumbName)
    if (fs.existsSync(thumbPath)) continue

    const srcPath = path.join(PORTFOLIO_DIR, file)
    await sharp(srcPath).resize(640, null, { withoutEnlargement: true, fit: 'inside' }).jpeg({ quality: 75 }).toFile(thumbPath)
    console.log(`  generado: ${thumbName}`)
    created++
  }

  console.log(`\n[DONE] ${created} thumb(s) generados de ${files.length} foto(s) revisadas`)
}

main().catch(err => {
  console.error('[ERROR]', err)
  process.exit(1)
})
