let slug = null
let photos = []
let currentIndex = 0
let projectInfo = null
let sessionId = null

document.addEventListener('DOMContentLoaded', () => {
  // Session ID persistente en localStorage
  sessionId = localStorage.getItem('gallery_session')
  if (!sessionId) {
    sessionId = crypto.randomUUID()
    localStorage.setItem('gallery_session', sessionId)
  }

  const params = new URLSearchParams(window.location.search)
  slug = params.get('slug')

  if (!slug) {
    const match = window.location.pathname.match(/^\/p\/([^/]+)/)
    if (match) slug = match[1]
  }

  if (!slug) {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;color:var(--text-2)">
        <p>Enlace inválido.</p>
      </div>
    `
    return
  }

  loadGallery()
})

async function loadGallery() {
  try {
    const res = await fetch(`${API_BASE}/gallery/${slug}?session_id=${sessionId}`)
    const data = await res.json()

    if (res.status === 401 && data.requiresPin) { showPinScreen(); return }
    if (res.status === 404) { showError('Este enlace no existe o ya no está disponible.'); return }
    if (res.status === 403) { showError('Esta galería no está disponible por el momento.'); return }
    if (!res.ok) { showError('Error cargando la galería.'); return }

    projectInfo = data.project
    photos = data.photos
    showWelcomeScreen()
  } catch {
    showError('No se pudo conectar con el servidor.')
  }
}

// ─── Welcome screen ───────────────────────────────────────────────────────────
function showWelcomeScreen() {
  const p = projectInfo
  const screen = document.getElementById('welcomeScreen')

  document.title = `${p.name} — Fotos`
  document.getElementById('welcomeTitle').textContent = p.name
  document.getElementById('welcomeMeta').textContent =
    `${p.photo_count} foto${p.photo_count !== 1 ? 's' : ''}`

  const bg = document.getElementById('welcomeBg')
  if (p.cover_url) bg.style.backgroundImage = `url('${p.cover_url}')`

  screen.style.display = 'flex'

  document.getElementById('welcomeBtn').addEventListener('click', () => {
    screen.classList.add('hidden')
    setTimeout(() => { screen.style.display = 'none' }, 600)
    renderGallery()
  })

  preloadThumbs()
}

function preloadThumbs() {
  photos.forEach(ph => {
    const img = new Image()
    img.src = ph.thumb_url
  })
}

// ─── PIN ──────────────────────────────────────────────────────────────────────
function showPinScreen() {
  document.getElementById('pinScreen').style.display = 'flex'
  document.getElementById('pinInput').focus()

  document.getElementById('pinForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const pin = document.getElementById('pinInput').value.trim()
    const errorEl = document.getElementById('pinError')
    const btn = document.getElementById('pinBtn')

    if (!pin) return
    btn.disabled = true
    btn.innerHTML = '<div class="spinner"></div>'
    errorEl.textContent = ''

    try {
      const res = await fetch(`${API_BASE}/gallery/${slug}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      })
      const data = await res.json()
      if (!res.ok) { errorEl.textContent = data.error || 'PIN incorrecto'; return }
      document.getElementById('pinScreen').style.display = 'none'
      loadGallery()
    } catch {
      errorEl.textContent = 'Error de conexión'
    } finally {
      btn.disabled = false
      btn.textContent = 'Continuar'
    }
  })
}

// ─── Render galería ───────────────────────────────────────────────────────────
function renderGallery() {
  const p = projectInfo

  document.getElementById('galleryTitle').textContent = p.name
  document.getElementById('galleryMeta').textContent =
    `${p.photo_count} foto${p.photo_count !== 1 ? 's' : ''}`
  document.getElementById('photoCountLabel').textContent =
    `${p.photo_count} foto${p.photo_count !== 1 ? 's' : ''}`

  const footer = document.getElementById('galleryFooter')
  if (footer && p.code) {
    footer.innerHTML = `
      <div style="margin-bottom:16px">
        <p style="font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:var(--text-3);margin-bottom:6px">Tu código de acceso</p>
        <p style="font-size:1.4rem;letter-spacing:.2em;font-weight:600;color:var(--accent);font-family:monospace">${p.code}</p>
      </div>
      <p style="color:var(--text-3);font-size:.75rem">carlangas.dpdns.org</p>
    `
  }

  document.getElementById('downloadAllBtn').addEventListener('click', () => {
    window.location.href = `${API_BASE}/gallery/${slug}/download`
  })

  const grid = document.getElementById('photoGrid')
  grid.innerHTML = photos.map((ph, i) => `
    <div class="photo-grid-item skeleton-wrap" data-index="${i}" data-id="${ph.id}">
      <div class="skeleton-placeholder"></div>
      <img
        src="${ph.thumb_url}"
        alt="Foto ${i + 1}"
        loading="lazy"
        decoding="async"
        style="opacity:0;width:100%;display:block;"
        onload="this.style.opacity='1';this.previousElementSibling.style.display='none'"
      >
      <div class="photo-grid-item-overlay">
        <button class="like-btn ${ph.liked ? 'liked' : ''}" data-id="${ph.id}" onclick="event.stopPropagation();toggleLike(${ph.id}, this)">
          <svg width="15" height="15" fill="${ph.liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          <span class="like-count">${ph.like_count > 0 ? ph.like_count : ''}</span>
        </button>
        <a class="photo-grid-item-download" href="${ph.original_url}" download onclick="event.stopPropagation()">
          ↓ Descargar
        </a>
      </div>
    </div>
  `).join('')

  grid.querySelectorAll('.photo-grid-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.photo-grid-item-download')) return
      if (e.target.closest('.like-btn')) return
      openLightbox(parseInt(item.dataset.index))
    })
  })

  document.getElementById('galleryPage').classList.add('visible')
  setupLightbox()
}

// ─── Like ─────────────────────────────────────────────────────────────────────
async function toggleLike(photoId, btn) {
  try {
    const res = await fetch(`${API_BASE}/gallery/${slug}/likes/${photoId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    })
    const data = await res.json()
    if (!res.ok) return

    const svg = btn.querySelector('svg')
    const countEl = btn.querySelector('.like-count')

    if (data.liked) {
      btn.classList.add('liked')
      svg.setAttribute('fill', 'currentColor')
    } else {
      btn.classList.remove('liked')
      svg.setAttribute('fill', 'none')
    }
    countEl.textContent = data.count > 0 ? data.count : ''

    // Sync en lightbox si está abierto
    const lbLikeBtn = document.getElementById('lightboxLikeBtn')
    if (lbLikeBtn && lbLikeBtn.dataset.id == photoId) {
      updateLightboxLikeBtn(lbLikeBtn, data.liked, data.count)
    }

    // Sync en photos array
    const ph = photos.find(p => p.id === photoId)
    if (ph) { ph.liked = data.liked; ph.like_count = data.count }
  } catch {}
}

function updateLightboxLikeBtn(btn, liked, count) {
  const svg = btn.querySelector('svg')
  const countEl = btn.querySelector('.like-count')
  if (liked) { btn.classList.add('liked'); svg.setAttribute('fill', 'currentColor') }
  else { btn.classList.remove('liked'); svg.setAttribute('fill', 'none') }
  countEl.textContent = count > 0 ? count : ''
}

// ─── Lightbox ────────────────────────────────────────────────────────────────
function setupLightbox() {
  const lightbox = document.getElementById('lightbox')

  document.getElementById('lightboxClose').addEventListener('click', closeLightbox)
  document.getElementById('lightboxPrev').addEventListener('click', () => navigate(-1))
  document.getElementById('lightboxNext').addEventListener('click', () => navigate(1))
  document.getElementById('lightboxLikeBtn').addEventListener('click', (e) => {
    const btn = document.getElementById('lightboxLikeBtn')
    toggleLike(parseInt(btn.dataset.id), btn)
    // Sync en grid
    const gridBtn = document.querySelector(`.photo-grid-item[data-id="${btn.dataset.id}"] .like-btn`)
    if (gridBtn) {
      const ph = photos.find(p => p.id == btn.dataset.id)
      if (ph) updateLightboxLikeBtn(gridBtn, ph.liked, ph.like_count)
    }
  })

  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox() })

  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('open')) return
    if (e.key === 'Escape') closeLightbox()
    if (e.key === 'ArrowLeft') navigate(-1)
    if (e.key === 'ArrowRight') navigate(1)
  })

  let touchStartX = 0
  lightbox.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX }, { passive: true })
  lightbox.addEventListener('touchend', (e) => {
    const diff = touchStartX - e.changedTouches[0].clientX
    if (Math.abs(diff) > 50) navigate(diff > 0 ? 1 : -1)
  }, { passive: true })
}

function openLightbox(index) {
  currentIndex = index
  updateLightboxContent()
  document.getElementById('lightbox').classList.add('open')
  document.body.style.overflow = 'hidden'
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open')
  document.body.style.overflow = ''
}

function navigate(dir) {
  currentIndex = (currentIndex + dir + photos.length) % photos.length
  updateLightboxContent()
}

function updateLightboxContent() {
  const ph = photos[currentIndex]
  const img = document.getElementById('lightboxImg')
  const spinner = document.getElementById('lightboxSpinner')

  img.style.opacity = '0'
  spinner.style.display = 'flex'

  const preview = new Image()
  preview.onload = () => {
    img.src = ph.preview_url
    img.style.opacity = '1'
    spinner.style.display = 'none'
  }
  preview.onerror = () => {
    spinner.style.display = 'none'
    img.style.opacity = '1'
  }
  preview.src = ph.preview_url

  document.getElementById('lightboxCounter').textContent = `${currentIndex + 1} / ${photos.length}`
  const dl = document.getElementById('lightboxDownload')
  dl.href = ph.original_url
  dl.download = ph.original_name || `foto-${currentIndex + 1}.jpg`

  const likeBtn = document.getElementById('lightboxLikeBtn')
  likeBtn.dataset.id = ph.id
  updateLightboxLikeBtn(likeBtn, ph.liked, ph.like_count)
}

// ─── Error ────────────────────────────────────────────────────────────────────
function showError(msg) {
  document.getElementById('pinScreen').style.display = 'none'
  document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:12px;color:var(--text-2);padding:20px;text-align:center">
      <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="opacity:.3">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p>${msg}</p>
    </div>
  `
}
