-- migration_watermark.sql
-- Correr una sola vez en la DB existente:
--   sqlite3 /mnt/almacenamiento/server/entrega_de_fotos/server/db/database.sqlite < migration_watermark.sql

-- Columna de estado del procesamiento
ALTER TABLE photos ADD COLUMN watermark_status TEXT NOT NULL DEFAULT 'done';
-- Las fotos existentes ya están "procesadas" (tienen thumbs/previews),
-- las marcamos como done para que no vuelvan a procesarse.

-- Nombre del archivo watermarked (puede diferir del original si el ext cambia a .png)
ALTER TABLE photos ADD COLUMN watermarked_filename TEXT;
-- Para fotos existentes, el watermarked_filename es el mismo que filename
-- (no tenían watermark, pero están en la carpeta antigua — ver nota de migración)

-- Índice para buscar fotos pendientes rápido
CREATE INDEX IF NOT EXISTS idx_photos_watermark_status ON photos(watermark_status);

-- NOTA DE MIGRACIÓN MANUAL:
-- Las fotos existentes siguen en uploads/[slug]/filename.jpg
-- La nueva estructura es uploads/[slug]/originals/filename.jpg
-- Si quieres migrar las fotos existentes a la nueva estructura, correr:
--   node server/utils/migrate_existing_photos.js
-- (ver ese archivo para instrucciones)
