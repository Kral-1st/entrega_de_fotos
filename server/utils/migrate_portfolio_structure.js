#!/usr/bin/env node
// server/utils/migrate_portfolio_structure.js
// Reorganiza uploads/_portfolio/ (que hasta ahora tenía todo suelto:
// <hex>.jpg + <hex>_thumb.jpg) a la misma estructura que usan los
// proyectos: originals/ previews/ thumbs/ (sin watermarked, acá no aplica).
//
// El <hex>.jpg suelto que ya existe se usa como "original" (no tenemos
// el archivo crudo que subiste, pero es la mejor fuente que hay) y de
// ahí se generan preview y thumb con los mismos tamaños/calidad que usa
// el resto del proyecto (config.upload.*).
//
// Uso: node server/utils/migrate_portfolio_structure.js

const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const config = require('../config')

const PORTFOLIO_DIR = path.join(__dirname, '../../uploads/_portfolio')
const ORIGINALS_DIR = path.join(PORTFOLIO_DIR, 'originals')
const PREVIEWS_DIR = path.join(PORTFOLIO_DIR, 'previews')
const THUMBS_DIR = path.join(PORTFOLIO_DIR, 'thumbs')

async function main() {
  if (!fs.existsSync(PORTFOLIO_DIR)) {
    console.log('[INFO] No existe uploads/_portfolio, nada que migrar.')
    return
  }

  for (const dir of [ORIGINALS_DIR, PREVIEWS_DIR, THUMBS_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const entries = fs.readdirSync(PORTFOLIO_DIR, { withFileTypes: true })
  const looseFiles = entries
    .filter(e => e.isFile() && e.name.endsWith('.jpg') && !e.name.endsWith('_thumb.jpg'))
    .map(e => e.name)

  if (looseFiles.length === 0) {
    console.log('[INFO] No hay archivos sueltos que migrar (¿ya se corrió este script?).')
    return
  }

  let migrated = 0
  for (const filename of looseFiles) {
    const loosePath = path.join(PORTFOLIO_DIR, filename)
    const originalPath = path.join(ORIGINALS_DIR, filename)
    const previewPath = path.join(PREVIEWS_DIR, filename)
    const thumbPath = path.join(THUMBS_DIR, filename)

    // mover el archivo suelto a originals/
    fs.renameSync(loosePath, originalPath)

    // generar preview y thumb a partir de ese original
    await sharp(originalPath).resize(config.upload.previewWidth, null, { withoutEnlargement: true, fit: 'inside' }).jpeg({ quality: config.upload.previewQuality }).toFile(previewPath)
    await sharp(originalPath).resize(config.upload.thumbWidth, null, { withoutEnlargement: true, fit: 'inside' }).jpeg({ quality: config.upload.thumbQuality }).toFile(thumbPath)

    // borrar el _thumb.jpg viejo si existía (esquema anterior)
    const oldThumb = path.join(PORTFOLIO_DIR, filename.replace(/\.jpg$/, '_thumb.jpg'))
    if (fs.existsSync(oldThumb)) fs.unlinkSync(oldThumb)

    console.log(`  migrado: ${filename}`)
    migrated++
  }

  console.log(`\n[DONE] ${migrated} foto(s) de portafolio reorganizadas en originals/previews/thumbs`)
}

main().catch(err => {
  console.error('[ERROR]', err)
  process.exit(1)
})
