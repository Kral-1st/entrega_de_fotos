#!/usr/bin/env node
// server/utils/migrate_existing_photos.js
// Mueve las fotos existentes (antes de implementar watermark) a la nueva estructura
//
// Antes: uploads/[slug]/filename.jpg
//        uploads/[slug]/thumbs/
//        uploads/[slug]/previews/
//
// Después: uploads/[slug]/originals/filename.jpg   ← movida
//          uploads/[slug]/watermarked/              ← vacía (no tienen watermark)
//          uploads/[slug]/thumbs/                   ← sin cambio
//          uploads/[slug]/previews/                 ← sin cambio
//
// Las fotos existentes mantienen watermark_status = 'done' (sin watermark, pero funcionales)
// Si quieres aplicarles watermark después, pon su status en 'pending' y corre /admin/process/:slug
//
// Uso: node server/utils/migrate_existing_photos.js

const fs   = require("fs");
const path = require("path");

const UPLOADS_BASE = path.join(__dirname, "../../uploads");

function migrateSlug(slug) {
  const slugDir      = path.join(UPLOADS_BASE, slug);
  const originalsDir = path.join(slugDir, "originals");

  const entries = fs.readdirSync(slugDir);
  const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif"]);
  const subdirs   = new Set(["originals", "watermarked", "thumbs", "previews"]);

  let moved = 0;

  for (const entry of entries) {
    const fullPath = path.join(slugDir, entry);
    const stat     = fs.statSync(fullPath);

    if (stat.isDirectory()) continue;
    if (subdirs.has(entry)) continue;

    const ext = path.extname(entry).toLowerCase();
    if (!imageExts.has(ext)) continue;

    // Mover a originals/
    fs.mkdirSync(originalsDir, { recursive: true });
    const dest = path.join(originalsDir, entry);
    fs.renameSync(fullPath, dest);
    console.log(`  [${slug}] movida: ${entry} → originals/${entry}`);
    moved++;
  }

  return moved;
}

function main() {
  if (!fs.existsSync(UPLOADS_BASE)) {
    console.log("[INFO] No existe carpeta uploads/, nada que migrar.");
    return;
  }

  const slugs = fs.readdirSync(UPLOADS_BASE).filter((d) => {
    if (d.startsWith("_")) return false; // _portfolio, etc.
    return fs.statSync(path.join(UPLOADS_BASE, d)).isDirectory();
  });

  if (slugs.length === 0) {
    console.log("[INFO] No hay proyectos en uploads/, nada que migrar.");
    return;
  }

  console.log(`[INFO] Migrando ${slugs.length} proyecto(s)...`);
  let totalMoved = 0;

  for (const slug of slugs) {
    const moved = migrateSlug(slug);
    totalMoved += moved;
  }

  console.log(`\n[DONE] ${totalMoved} foto(s) movidas a originals/`);
  console.log("[INFO] Las fotos existentes mantienen watermark_status='done'");
  console.log("[INFO] Sus thumbs y previews siguen funcionando sin cambios");
}

main();
