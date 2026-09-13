-- Admin (una sola cuenta)
CREATE TABLE IF NOT EXISTS admin (
  id INTEGER PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Proyectos
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  description TEXT,
  pin TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  code TEXT,
  cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  download_click_count INTEGER NOT NULL DEFAULT 0,
  watermark_enabled INTEGER NOT NULL DEFAULT 1,
  visible_watermark_enabled INTEGER NOT NULL DEFAULT 1
);

-- Fotos
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  watermark_status TEXT NOT NULL DEFAULT 'done',
  watermarked_filename TEXT,
  captured_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Portafolio público (home)
CREATE TABLE IF NOT EXISTS portfolio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Likes de clientes en la galería (por session_id, sin cuenta)
CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  created_at DATETIME DEFAULT (datetime('now')),
  UNIQUE(photo_id, session_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_code ON projects(code);
CREATE INDEX IF NOT EXISTS idx_photos_project_id ON photos(project_id);
CREATE INDEX IF NOT EXISTS idx_photos_watermark_status ON photos(watermark_status);
CREATE INDEX IF NOT EXISTS idx_portfolio_order ON portfolio(sort_order);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  detail TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Vistas únicas de galería, deduplicadas por session_id (mismo id que usan los likes)
CREATE TABLE IF NOT EXISTS gallery_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, session_id)
);

-- Suscripciones a notificaciones de fotos nuevas
CREATE TABLE IF NOT EXISTS notification_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK(channel IN ('push','email')),
  target TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, channel, target)
);
CREATE INDEX IF NOT EXISTS idx_notif_project ON notification_subscribers(project_id);
