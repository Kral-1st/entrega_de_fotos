# Entrega de Fotos

Plataforma self-hosted de entrega de fotografías para clientes (fotógrafo → cliente). Permite subir fotos por proyecto, aplicarles marca de agua (invisible + visible) de forma distribuida entre varias máquinas, y compartir una galería protegida por PIN donde el cliente puede ver, dar like y descargar sus fotos.

Repo: `Kral-1st/entrega_de_fotos`

---

## Índice

- [Arquitectura general](#arquitectura-general)
- [Stack técnico](#stack-técnico)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Instalación](#instalación)
- [Variables de entorno](#variables-de-entorno)
- [Base de datos](#base-de-datos)
- [Rutas de la API](#rutas-de-la-api)
- [Pipeline de watermark](#pipeline-de-watermark)
- [Procesamiento distribuido (SERVER + TUF)](#procesamiento-distribuido-server--tuf)
- [Frontend](#frontend)
- [nginx](#nginx)
- [Seguridad](#seguridad)
- [Cosas pendientes / deuda técnica conocida](#cosas-pendientes--deuda-técnica-conocida)

---

## Arquitectura general

```
┌─────────────────────┐        ┌──────────────────────────┐
│   Cliente (browser)  │        │   Admin (fotógrafo)       │
│  fotos.example...  │        │  fotos.example.../admin │
└──────────┬───────────┘        └────────────┬─────────────┘
           │                                  │
           │ mismo origen (nginx)             │ Bearer JWT
           ▼                                  ▼
   ┌───────────────────────────────────────────────────┐
   │  nginx                                              │
   │   - sirve /admin, /gallery, /p/:slug (estáticos)    │
   │   - location ^~ /api/  →  proxy_pass 127.0.0.1:3555 │
   └───────────────────────┬────────────────────────────┘
                            ▼
                 ┌─────────────────────┐
                 │  Express (server/)  │  puerto 3555
                 └──────────┬──────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  SQLite (better-       Filesystem           Cola de watermark
  sqlite3, WAL)         /uploads/<slug>/...  (server/utils/watermarkQueue.js)
                                                    │
                                    ┌───────────────┼────────────────┐
                                    ▼                                ▼
                         Workers locales (SERVER)          worker-client.js (EXTERNO)
                         watermark.py (venv local)          watermark.py (venv propio)
                                    │                                │
                                    └──────── mismo storage NFS ─────┘
```


---

## Stack técnico

**Backend**
- Node.js + Express 4
- `better-sqlite3` (SQLite, WAL mode)
- `bcryptjs` + `jsonwebtoken` — auth del admin
- `multer` — uploads
- `sharp` — thumbnails, previews, redimensionado
- `archiver` — ZIPs de descarga
- `cookie-parser` — cookies de acceso a galerías con PIN
- `express-rate-limit` — rate limiting en login
- PM2 — proceso persistente

**Watermarking**
- Python 3 (venv propio en `/watermark`)
- `opencv-python` (`cv2`) — lectura/escritura de imágenes y overlay visible
- `imWatermark` (`WatermarkEncoder`/`WatermarkDecoder`) — watermark invisible (esteganografía DWT/DCT/SVD)
- `exiftool` — preservar metadatos EXIF del original

**Frontend**
- Vanilla JS + CSS, sin framework ni build step (los `.js` se sirven tal cual)
- Tres superficies: `client/admin` (panel del fotógrafo), `client/gallery` (galería del cliente), `client/index.html` (portafolio público)

**Infra**
- nginx como reverse proxy y servidor de estáticos
- Cloudflare Tunnel para acceso externo
- Netbird (mesh VPN) para acceso interno entre SERVER y TUF
- PM2 para mantener vivo el proceso de Node

---

## Estructura del proyecto

```
entrega_de_fotos/
├── client/
│   ├── admin/                  # Panel del fotógrafo (JWT)
│   │   ├── index.html          # Login
│   │   ├── dashboard.html/js   # Lista de proyectos + portafolio público
│   │   └── project.html/js     # Detalle de proyecto: subir fotos, procesar, cover
│   ├── gallery/
│   │   ├── index.html
│   │   └── js/gallery.js       # PIN, welcome screen, grid, lightbox, likes
│   ├── shared.css / shared.js  # helpers de fetch, auth, toasts — compartidos
│   └── index.html              # Portafolio público (home)
│
├── server/
│   ├── index.js                 # Entry point: CORS, cookies, rutas, arranque
│   ├── config.js                 # Lee .env, sin defaults inseguros
│   ├── db/
│   │   ├── schema.sql             # Tablas base (admin, projects, photos)
│   │   ├── migration_watermark.sql
│   │   └── database.js            # init + wrapper de better-sqlite3
│   ├── middleware/
│   │   ├── adminAuth.js           # JWT Bearer, rol admin
│   │   ├── projectAccess.js       # Valida proyecto + PIN (cookie firmada)
│   │   └── workerAuth.js          # Shared secret para workers de watermark
│   ├── routes/
│   │   ├── auth.js                # login/verify del admin
│   │   ├── admin.js               # CRUD proyectos y fotos (protegido)
│   │   ├── gallery.js             # API pública de galería (PIN, fotos, likes, zip)
│   │   ├── portfolio.js           # Portafolio público de la home
│   │   ├── processing.js          # Dispara/consulta batches de watermark
│   │   └── worker.js              # Endpoints internos para workers remotos
│   └── utils/
│       ├── watermark.js           # Orquesta watermark.py + thumbs/previews
│       ├── watermarkQueue.js      # Cola pull compartida (local + remoto)
│       ├── storage.js             # Rutas de disco por proyecto, thumbs/previews
│       ├── zip.js                 # Streaming de ZIP con archiver
│       └── migrate_existing_photos.js
│
├── watermark/
│   ├── watermark.py               # Overlay visible + watermark invisible + EXIF
│   ├── firma-blanca.png / firma-negra.png
│   ├── requirements.txt
│   └── setup_venv.sh
│
├── nginx.conf                     # Config real (2 hosts × HTTP/HTTPS)
├── ecosystem.config.js            # PM2 (SERVER)
├── example.env
└── package.json
```

---

## Instalación

```bash
git clone <repo>
cd entrega_de_fotos
npm install
cp example.env .env      # llenar con valores reales, ver abajo

# Watermark (Python)
cd watermark
./setup_venv.sh          # crea venv/ e instala requirements.txt
cd ..

# Base de datos: se inicializa sola al arrancar (schema.sql + admin por defecto)
npm start                 # o: pm2 start ecosystem.config.js
```

Para que un segundo equipo (ej. TUF) actúe como **worker de watermark**, necesita: el mismo repo clonado, su propio venv de Python (los binarios de `opencv`/`imwatermark` no son portables entre máquinas), acceso al mismo storage compartido (NFS, mismo `UPLOADS_PATH`), y correr `node server/worker-client.js` con las env vars de worker (ver abajo).

---

## Variables de entorno

Basado en `example.env`:

| Variable | Uso |
|---|---|
| `PORT` | Puerto de Express (3555) |
| `NODE_ENV` | `production` habilita cookies `Secure` |
| `API_DOMAIN` / `FRONTEND_DOMAIN` | Usados en CORS y en la construcción de URLs |
| `JWT_SECRET` | Firma de tokens de admin **y** de las cookies de acceso a galerías con PIN |
| `JWT_EXPIRES_IN` | Expiración del token de admin |
| `ADMIN_PASSWORD` | Se hashea con bcrypt al primer arranque, crea la única cuenta admin |
| `UPLOADS_PATH` | Raíz de `uploads/<slug>/{originals,watermarked,thumbs,previews}` |
| `DB_PATH` | Ruta del `.sqlite` |
| `WM_FIRMA` | Texto embebido en el watermark invisible |
| `WM_ALGORITMO` | `dwtDct` / `dwtDctSvd` / `rivaGan` |
| `WM_CONCURRENCY` | Cuántas fotos procesa en paralelo el worker **local** |
| `WM_FIRMA_BLANCA` / `WM_FIRMA_NEGRA` | PNGs con alpha de la firma visible (blanca/negra según fondo) |
| `WM_FIRMA_ANCHO_PCT` / `WM_FIRMA_OPACIDAD` | Tamaño y opacidad del overlay visible |
| `WM_WORKER_SECRET` | Header compartido para autenticar workers remotos contra `/internal/worker` |
| `CDW` / `ERROR_FILE` / `OUT_FILE` | Paths usados por PM2 (`ecosystem.config.js`) |

Variables adicionales usadas por **workers remotos** (no están en `example.env` porque solo aplican a TUF, no a SERVER):

| Variable | Uso |
|---|---|
| `WORKER_SERVER_URL` | URL de SERVER, ej. `http://100.119.94.64:3555` (vía Netbird) |
| `WORKER_CONCURRENCY` | Cuántas fotos procesa en paralelo ese worker remoto — súbelo si esa máquina tiene más cores libres |

---

## Base de datos

SQLite vía `better-sqlite3`, modo WAL. `schema.sql` define lo base:

- **`admin`** — una sola fila, `password_hash` (bcrypt).
- **`projects`** — `slug` único, `pin` opcional, `is_active`.
- **`photos`** — `project_id` (FK cascade), `filename`, `original_name`, dimensiones.

`migration_watermark.sql` agrega `watermark_status` (`pending`/`processing`/`done`/`error`) y `watermarked_filename`.

> ⚠️ **Nota:** el código en producción también usa columnas/tablas que no están en `schema.sql` ni en `migration_watermark.sql` — `projects.code`, `projects.cover_photo_id`, y una tabla `likes` (`photo_id`, `session_id`) completa, además de una tabla `portfolio` (`filename`, `sort_order`) para la home pública. Estas se agregaron en algún momento directo contra la DB en producción y **no quedaron documentadas en ningún `.sql` del repo**. Si se necesita levantar la DB desde cero, hay que reconstruir esas migraciones a mano — ver [Pendientes](#cosas-pendientes--deuda-técnica-conocida).

---

## Rutas de la API

Todo bajo `/api/` en producción (proxeado por nginx a Express en :3555).

### `/auth` — admin
- `POST /login` — contraseña → JWT (rate-limited, 10 intentos/15min)
- `GET /verify` — valida el JWT actual

### `/admin` — panel (requiere `Authorization: Bearer <jwt>`)
- `GET /projects`, `GET /projects/:id`, `POST /projects`, `PUT /projects/:id`, `DELETE /projects/:id`
- `POST /projects/:id/photos` — sube hasta 100 fotos, quedan en `pending`
- `DELETE /photos/:photoId`
- `PUT /projects/:id/cover` — foto de portada de la galería

### `/admin/process` — disparo de watermark (requiere JWT)
- `GET /status/:slug` — conteo por estado + si está procesando
- `POST /:slug` — encola las fotos `pending` de ese proyecto

### `/internal/worker` — comunicación con workers de watermark (shared secret, `x-worker-secret`)
- `GET /next` — siguiente foto pendiente de cualquier batch activo
- `POST /done` — reporta resultado de una foto procesada

### `/gallery` — pública, protegida por PIN cuando el proyecto lo tiene
- `GET /code/:code` — resuelve un código de 6 caracteres a un slug
- `POST /:slug/unlock` — valida PIN, si es correcto pone cookie `gallery_access_<slug>` (JWT firmado, httpOnly, 2h)
- `GET /:slug` — info del proyecto + fotos (`watermark_status = 'done'` únicamente)
- `GET /:slug/thumb/:filename`, `/:slug/preview/:filename`, `/:slug/original/:filename`
- `GET /:slug/download` — ZIP de todas las fotos (desde `watermarked/`)
- `POST /:slug/likes/:photoId` — toggle de like por `session_id` (localStorage del cliente)

### `/portfolio` — home pública
- CRUD del carrusel/galería de portada (protegido con JWT salvo el `GET`)

---

## Pipeline de watermark

Cada foto pasa por **dos** capas de marca de agua, en este orden estricto (importante: el overlay visible se aplica **antes** de encodear el watermark invisible, para que este último se calcule sobre los píxeles finales):

1. **Overlay visible** (`pegar_firma_visible` en `watermark.py`)
   - Mide el brillo promedio de la esquina inferior izquierda.
   - Elige `firma-blanca.png` o `firma-negra.png` según ese brillo.
   - Compone el logo (PNG con canal alpha) con opacidad configurable.

2. **Watermark invisible** (`imwatermark`, algoritmo `dwtDctSvd` por default)
   - Embebe `WM_FIRMA` en el dominio de frecuencia de la imagen.
   - Se verifica después de encodear, comparando bit a bit contra un umbral del 90% de similitud — tolera la degradación normal de guardar/comprimir.
   - Si la verificación falla, `watermark.py` sale con código `2` (no `1`) — `watermark.js` interpreta eso como *dudoso pero aceptable* y no reintenta infinitamente.

3. **EXIF** — se copian los metadatos del original al archivo procesado con `exiftool` (si no está instalado, solo se loguea un warning, no falla el batch).

Salida: siempre `.png` (por el paso de watermark invisible), guardado en `watermarked/`. De ahí se generan `thumbs/` y `previews/` con `sharp`.

---

## Procesamiento distribuido (SERVER + TUF)

El watermark es 100% CPU (no hay aceleración GPU aplicable, a diferencia de Immich con NVENC). Para repartir carga entre SERVER y TUF sin que se pisen, se usa un modelo **pull** en vez de repartir fotos de antemano:

- `server/utils/watermarkQueue.js` mantiene una cola en memoria por batch (`slug`). `getNextAny()` hace `Array.shift()` — atómico dentro del single-thread de Node, así que dos workers nunca agarran la misma foto sin necesidad de locks.
- **Workers locales** (en SERVER): corren dentro del mismo proceso Express, tantos en paralelo como diga `WM_CONCURRENCY`.
- **Workers remotos** (TUF, o cualquier otra máquina): proceso Node aparte (`server/worker-client.js`), corriendo con PM2 en esa máquina, haciendo polling a `GET /internal/worker/next` cada vez que tiene un slot libre (`WORKER_CONCURRENCY`), procesando localmente con su propio `watermark.py`/venv, y reportando con `POST /internal/worker/done`.
- Cada máquina jala **a su propia capacidad real** (sube `WORKER_CONCURRENCY` en la que tenga más cores libres) — no hay reparto fijo 50/50.
- Requiere que ambas máquinas vean el mismo `UPLOADS_PATH` (vía NFS ya existente entre SERVER y TUF).

---

## Frontend

Tres superficies, sin build step — `.js`/`.css` planos servidos por nginx:

- **`client/admin/`** — Login (`index.html`) → Dashboard (lista de proyectos + portafolio) → Detalle de proyecto (subir fotos, ver estado de watermark, disparar procesamiento, elegir cover). Usa JWT en `localStorage`, mandado como `Authorization: Bearer` en cada request (`apiFetch` en `shared.js`).
- **`client/gallery/`** — Welcome screen → grid de fotos (masonry con overlay de like/descarga, oculto en touch hasta abrir el lightbox) → lightbox con swipe/teclado. Usa un `session_id` random persistido en `localStorage` para trackear likes sin cuenta. Si el proyecto tiene PIN, `loadGallery()` recibe 401 y muestra `pinScreen`; al desbloquear, el servidor pone una cookie httpOnly que autoriza esa sesión de navegador específicamente (no un desbloqueo global).
- **`shared.js`/`shared.css`** — helpers comunes (`apiFetch`, manejo de token, toasts, formateo).

`API_BASE = '/api'` — todas las llamadas son same-origin respecto al frontend, sin importar si se accede vía Cloudflare Tunnel o directo por Netbird.

---

## nginx

Dos hosts (`fotos.example.org` y `api-fotos.example.org`), cada uno con bloque HTTP y HTTPS. El frontend además expone:

```nginx
location ^~ /api/ {
    proxy_pass http://127.0.0.1:3555/;
    ...
}
```

El `^~` es necesario porque hay locations con regex para assets estáticos (`\.(css|js|png|jpg|...)$`) que de otra forma le ganarían a `/api/` en cualquier URL que termine en una extensión de imagen (como los thumbnails).

`api-fotos.example.org` se deja activo en paralelo por compatibilidad/pruebas directas a la API, aunque el frontend ya no lo usa.

---

## Seguridad

Cosas ya resueltas que vale la pena que quien lea esto sepa que **no** son accidentales:

- `config.js` no tiene fallbacks inseguros para `JWT_SECRET`/`ADMIN_PASSWORD` — si falta el `.env`, el proceso truena en vez de arrancar con un secreto adivinable.
- El acceso a galerías con PIN es **por cliente**, no global: cada navegador recibe su propia cookie firmada (JWT) ligada a ese slug específico, en vez de un flag compartido que cualquiera podría aprovechar dentro de la ventana de expiración.
- Rutas de `/thumb`, `/preview`, `/original` sanitizan el filename con `path.basename()` antes de tocar el filesystem.
- `/auth/login` tiene rate limiting; `/gallery/:slug/unlock` (el PIN) también debería tenerlo — ver pendientes.
- No hay IPs internas ni credenciales hardcodeadas en el código fuente — todo lo sensible vive en `.env` (nunca comiteado; confirmado que no existe en el historial de git).

---

## Cosas pendientes / deuda técnica conocida

- **Rate limiting en `/gallery/:slug/unlock`** — actualmente el PIN se puede intentar sin límite. Debería llevar el mismo `express-rate-limit` que ya tiene `/auth/login`.
- **Comparación del PIN no es constante en tiempo** (`project.pin !== pin`) — de baja prioridad si el rate limit de arriba se implementa, pero vale la pena `crypto.timingSafeEqual` en algún momento.
- **`workerAuth.js` compara el secret con `!==`**, no constante en tiempo — bajo riesgo porque ese endpoint solo debería ser alcanzable dentro de la red Netbird, pero anótalo si algún día se expone más ampliamente.
- **Schema de la DB incompleto en el repo**: `projects.code`, `projects.cover_photo_id`, la tabla `likes` y la tabla `portfolio` existen en producción pero no en ningún `.sql` versionado. Si se necesita reconstruir la base desde cero (nueva instalación, disaster recovery), hace falta escribir esas migraciones a mano primero.
- **Doble listener en el formulario de PIN** (`showPinScreen()` en `gallery.js`) — si la pantalla de PIN se vuelve a mostrar más de una vez en la misma carga de página (por ejemplo, si el desbloqueo falla y se reintenta), se apila otro `addEventListener` sobre el mismo form, duplicando el submit. Hay que guardar un flag para adjuntarlo una sola vez.
