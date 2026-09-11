const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const config = require('../config')

function getProjectDir(slug) {
  return path.join(config.paths.uploads, slug)
}

function getOriginalsDir(slug) {
  return path.join(getProjectDir(slug), 'originals')
}

function getWatermarkedDir(slug) {
  return path.join(getProjectDir(slug), 'watermarked')
}

function getThumbsDir(slug) {
  return path.join(getProjectDir(slug), 'thumbs')
}

function getPreviewsDir(slug) {
  return path.join(getProjectDir(slug), 'previews')
}

function ensureProjectDirs(slug) {
  const dirs = [
    getOriginalsDir(slug),
    getWatermarkedDir(slug),
    getThumbsDir(slug),
    getPreviewsDir(slug)
  ]
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }
}

async function generateThumb(slug, filename) {
  const watermarkedPath = path.join(getWatermarkedDir(slug), filename.replace(/\.[^.]+$/, '.png'))
  // Si existe watermarked usa ese, si no usa original (fotos legacy)
  const sourcePath = fs.existsSync(watermarkedPath)
    ? watermarkedPath
    : path.join(getOriginalsDir(slug), filename)

  const thumbFilename = filename.replace(/\.[^.]+$/, '.jpg')
  const thumbFinalPath = path.join(getThumbsDir(slug), thumbFilename)

  await sharp(sourcePath)
    .rotate()
    .resize(config.upload.thumbWidth, null, { withoutEnlargement: true, fit: 'inside' })
    .jpeg({ quality: config.upload.thumbQuality })
    .toFile(thumbFinalPath)

  return thumbFilename
}

async function generatePreview(slug, filename) {
  const watermarkedPath = path.join(getWatermarkedDir(slug), filename.replace(/\.[^.]+$/, '.png'))
  const sourcePath = fs.existsSync(watermarkedPath)
    ? watermarkedPath
    : path.join(getOriginalsDir(slug), filename)

  const previewFilename = filename.replace(/\.[^.]+$/, '.jpg')
  const previewFinalPath = path.join(getPreviewsDir(slug), previewFilename)

  await sharp(sourcePath)
    .rotate()
    .resize(config.upload.previewWidth, null, { withoutEnlargement: true, fit: 'inside' })
    .jpeg({ quality: config.upload.previewQuality })
    .toFile(previewFinalPath)

  return previewFilename
}

async function getImageMeta(filePath) {
  try {
    const meta = await sharp(filePath).metadata()
    return { width: meta.width || null, height: meta.height || null }
  } catch {
    return { width: null, height: null }
  }
}

function deleteProjectFiles(slug) {
  const dir = getProjectDir(slug)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function deletePhotoFiles(slug, filename) {
  const stem = filename.replace(/\.[^.]+$/, '')

  const filesToDelete = [
    path.join(getOriginalsDir(slug),   filename),
    path.join(getWatermarkedDir(slug), stem + '.png'),
    path.join(getThumbsDir(slug),      stem + '.jpg'),
    path.join(getPreviewsDir(slug),    stem + '.jpg'),
  ]

  for (const f of filesToDelete) {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f) } catch { /* continuar */ }
    }
  }
}

module.exports = {
  getProjectDir,
  getOriginalsDir,
  getWatermarkedDir,
  getThumbsDir,
  getPreviewsDir,
  ensureProjectDirs,
  generateThumb,
  generatePreview,
  getImageMeta,
  deleteProjectFiles,
  deletePhotoFiles
}
