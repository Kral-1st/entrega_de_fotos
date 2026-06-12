const FRONTEND_BASE = 'https://fotos.carlangas.dpdns.org'

let projectId = null
let projectData = null
let pollingInterval = null

document.addEventListener('DOMContentLoaded', async () => {
  if (!await requireAuth()) return

  const params = new URLSearchParams(window.location.search)
  projectId = params.get('id')
  if (!projectId) { window.location.href = 'dashboard.html'; return }

  await loadProject()
  setupUpload()
  setupModals()
})

// ─── Cargar proyecto ─────────────────────────────────────────────────────────
async function loadProject() {
  try {
    const res = await apiJSON(`/admin/projects/${projectId}`)
    const data = await res.json()
    if (!res.ok) { showToast(data.error, 'error'); return }

    projectData = data.project
    renderProjectHeader(data.project)
    renderPhotos(data.photos)

    // Si hay fotos pendientes/procesando al cargar, arrancar polling
    const hasPending = data.photos.some(
      p => p.watermark_status === 'pending' || p.watermark_status === 'processing'
    )
    if (hasPending) {
      showProcessingBanner(true)
      startPolling()
    }
  } catch {
    showToast('Error cargando proyecto', 'error')
  }
}

function renderProjectHeader(p) {
  document.title = `${p.name} — Entrega de Fotos`
  document.getElementById('breadcrumbName').textContent = p.name
  const codeEl = document.getElementById('projectCode')
  if (codeEl) codeEl.textContent = p.code || '——'
  document.getElementById('projectName').textContent = p.name
  document.getElementById('projectClient').textContent = `Cliente: ${p.client_name}`
  document.getElementById('projectDesc').textContent = p.description || ''
  document.getElementById('projectDate').textContent = formatDate(p.created_at)

  const statusBadge = document.getElementById('statusBadge')
  statusBadge.textContent = p.is_active ? 'Activo' : 'Inactivo'
  statusBadge.className = `badge ${p.is_active ? 'badge--active' : 'badge--inactive'}`

  const pinBadge = document.getElementById('pinBadge')
  pinBadge.style.display = p.pin ? '' : 'none'

  const clientLink = `${FRONTEND_BASE}/p/${p.slug}`
  document.getElementById('clientLink').textContent = clientLink
  document.getElementById('openLinkBtn').href = clientLink
}

function renderPhotos(photos) {
  const grid = document.getElementById('photosGrid')
  const countEl = document.getElementById('photosCount')
  const downloadBtn = document.getElementById('downloadZipBtn')
  const photoCountVal = document.getElementById('photoCountVal')

  const donePhotos = photos.filter(p => p.watermark_status === 'done')
  photoCountVal.textContent = donePhotos.length
  countEl.textContent = `(${donePhotos.length})`
  downloadBtn.style.display = donePhotos.length > 0 ? '' : 'none'

  if (photos.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        <p>Sin fotos. Sube las primeras arriba.</p>
      </div>
    `
    return
  }

  const coverId = projectData.cover_photo_id || null

  grid.innerHTML = photos.map(ph => {
    if (ph.watermark_status === 'done') {
      return `
        <div class="photo-item" data-id="${ph.id}" data-filename="${escHtml(ph.filename)}">
          <img
            src="${API_BASE}/admin/thumb/${projectData.slug}/${ph.filename.replace(/\.[^.]+$/, '.jpg')}?token=${getToken()}"
            alt="${escHtml(ph.original_name)}"
            loading="lazy"
            onerror="this.style.opacity='.3'"
          >
          ${coverId === ph.id ? `<div class="cover-badge">★ Portada</div>` : ''}
          <div class="photo-item-overlay">
            <button class="photo-cover-btn ${coverId === ph.id ? 'active' : ''}" title="${coverId === ph.id ? 'Quitar portada' : 'Usar como portada'}" onclick="setCover(${ph.id}, ${coverId === ph.id})">
              <svg width="15" height="15" fill="${coverId === ph.id ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            </button>
            <button class="photo-delete-btn" title="Eliminar" onclick="deletePhoto(${ph.id})">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
              </svg>
            </button>
          </div>
        </div>
      `
    }

    // Foto pendiente o en procesamiento
    const isPending = ph.watermark_status === 'pending' || ph.watermark_status === 'processing'
    const isError = ph.watermark_status === 'error'
    return `
      <div class="photo-item photo-item--pending" data-id="${ph.id}">
        <div class="photo-pending-overlay">
          ${isError
            ? `<span class="photo-pending-icon">⚠️</span><span class="photo-pending-label">Error</span>`
            : `<span class="photo-pending-icon">⏳</span><span class="photo-pending-label">${ph.watermark_status === 'processing' ? 'Procesando...' : 'En cola'}</span>`
          }
        </div>
        <div class="photo-item-overlay">
          <button class="photo-delete-btn" title="Eliminar" onclick="deletePhoto(${ph.id})">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
          </button>
        </div>
        <p class="photo-pending-name">${escHtml(ph.original_name)}</p>
      </div>
    `
  }).join('')
}

// ─── Upload ──────────────────────────────────────────────────────────────────
function setupUpload() {
  const zone = document.getElementById('uploadZone')
  const input = document.getElementById('fileInput')
  const progress = document.getElementById('uploadProgress')
  const progressBar = document.getElementById('progressBar')
  const progressText = document.getElementById('progressText')
  const progressPct = document.getElementById('progressPct')

  zone.addEventListener('click', () => input.click())

  zone.addEventListener('dragover', (e) => {
    e.preventDefault()
    zone.classList.add('drag-over')
  })
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'))
  zone.addEventListener('drop', (e) => {
    e.preventDefault()
    zone.classList.remove('drag-over')
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
    if (files.length) uploadFiles(files)
  })

  input.addEventListener('change', () => {
    if (input.files.length) uploadFiles(Array.from(input.files))
    input.value = ''
  })

  // Descarga ZIP
  document.getElementById('downloadZipBtn').addEventListener('click', () => {
    window.location.href = `${API_BASE}/gallery/${projectData.slug}/download`
  })

  async function uploadFiles(files) {
    progress.classList.add('active')
    progressBar.style.width = '0%'
    progressPct.textContent = '0%'
    progressText.textContent = `Subiendo ${files.length} foto${files.length !== 1 ? 's' : ''}...`

    let uploaded = 0
    let errors = 0

    for (let i = 0; i < files.length; i++) {
      const form = new FormData()
      form.append('photos', files[i])

      try {
        const res = await fetch(`${API_BASE}/admin/projects/${projectId}/photos`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${getToken()}` },
          body: form
        })
        const data = await res.json()
        if (res.ok) {
          uploaded += data.uploaded
          if (data.errors) errors += data.errors.length
        } else {
          errors++
        }
      } catch {
        errors++
      }

      await new Promise(r => setTimeout(r, 500))

      const pct = Math.round(((i + 1) / files.length) * 100)
      progressBar.style.width = `${pct}%`
      progressPct.textContent = `${pct}%`
      progressText.textContent = `Subiendo ${i + 1} de ${files.length}...`
    }

    progress.classList.remove('active')

    const msg = errors > 0
      ? `${uploaded} subidas, ${errors} con error`
      : `${uploaded} foto${uploaded !== 1 ? 's' : ''} subida${uploaded !== 1 ? 's' : ''}`

    showToast(msg, errors > 0 ? 'error' : 'success')

    // Actualizar grid con las fotos recién subidas (en estado pending)
    await loadProject()

    // Disparar procesamiento automático si hubo uploads exitosos
    if (uploaded > 0) {
      triggerProcessing()
    }
  }
}

// ─── Procesamiento watermark ──────────────────────────────────────────────────
async function triggerProcessing() {
  try {
    const res = await apiJSON(`/admin/process/${projectData.slug}`, { method: 'POST' })
    const data = await res.json()

    if (data.started) {
      showProcessingBanner(true, `0 de ${data.count} fotos listas`)
      startPolling()
    }
  } catch (err) {
    console.error('Error iniciando procesamiento:', err)
  }
}

function startPolling() {
  if (pollingInterval) return

  pollingInterval = setInterval(async () => {
    try {
      const res = await apiJSON(`/admin/process/status/${projectData.slug}`)
      const status = await res.json()

      // Actualizar contador en el banner
      updateProcessingBanner(`${status.done} de ${status.total} fotos listas`)

      // Terminar si ya no hay nada pendiente
      if (!status.isProcessing && status.pending === 0 && status.processing === 0) {
        clearInterval(pollingInterval)
        pollingInterval = null
        showProcessingBanner(false)
        await loadProject()

        if (status.error > 0) {
          showToast(`${status.done} fotos procesadas, ${status.error} con error`, 'error')
        } else {
          showToast(`${status.done} fotos listas`, 'success')
        }
      }
    } catch (err) {
      console.error('Error en polling:', err)
    }
  }, 2500)
}

function showProcessingBanner(visible, detail = 'Aplicando firma invisible y generando previews...') {
  let banner = document.getElementById('processingBanner')

  if (visible) {
    if (!banner) {
      banner = document.createElement('div')
      banner.id = 'processingBanner'
      banner.className = 'processing-banner'
      // Insertar antes del grid de fotos
      const grid = document.getElementById('photosGrid')
      grid.parentNode.insertBefore(banner, grid)
    }
    banner.innerHTML = `
      <div class="processing-banner__spinner"></div>
      <div class="processing-banner__text">
        <strong>Procesando fotos...</strong>
        <span id="processingBannerDetail">${detail}</span>
      </div>
    `
  } else if (banner) {
    banner.remove()
  }
}

function updateProcessingBanner(detail) {
  const el = document.getElementById('processingBannerDetail')
  if (el) el.textContent = detail
}

// ─── Modales ─────────────────────────────────────────────────────────────────
function setupModals() {
  // Copiar link (Compatible con HTTP, HTTPS y archivos locales)
  const copyBtn = document.getElementById('copyLinkBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const linkEl = document.getElementById('clientLink');
      const link = linkEl ? linkEl.textContent.trim() : '';

      if (link === '—' || link === '') {
        if (typeof showToast === 'function') showToast('El enlace aún no se ha generado', 'error');
        return;
      }

      // INTENTO 1: API Moderna (Navigator Clipboard)
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(link)
        .then(() => {
          if (typeof showToast === 'function') showToast('Link copiado', 'success');
        })
        .catch(err => fallbackCopy(link)); // Si falla la API moderna, intenta el plan B
      } else {
        // INTENTO 2: Plan B para entornos no seguros (HTTP / File)
        fallbackCopy(link);
      }
    });
  }

  // Función auxiliar de respaldo (Plan B)
  function fallbackCopy(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    // Aseguramos que sea invisible para el usuario
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    document.body.appendChild(textArea);
    textArea.select();

    try {
      document.execCommand('copy'); // Método antiguo pero infalible en HTTP
      if (typeof showToast === 'function') showToast('Link copiado', 'success');
    } catch (err) {
      console.error('Error total al copiar:', err);
      if (typeof showToast === 'function') showToast('No se pudo copiar el enlace', 'error');
    }

    document.body.removeChild(textArea);
  }

  // Modal editar
  const editModal = document.getElementById('editModal')
  document.getElementById('editProjectBtn').addEventListener('click', () => {
    const p = projectData
    document.getElementById('editName').value = p.name
    document.getElementById('editClient').value = p.client_name
    document.getElementById('editDesc').value = p.description || ''
    document.getElementById('editPin').value = p.pin || ''
    document.getElementById('editActive').value = p.is_active ? '1' : '0'
    editModal.classList.add('open')
  })
  document.getElementById('cancelEditBtn').addEventListener('click', () => editModal.classList.remove('open'))
  editModal.addEventListener('click', (e) => { if (e.target === editModal) editModal.classList.remove('open') })

  document.getElementById('editForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      const res = await apiJSON(`/admin/projects/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: document.getElementById('editName').value.trim(),
          client_name: document.getElementById('editClient').value.trim(),
          description: document.getElementById('editDesc').value.trim() || null,
          pin: document.getElementById('editPin').value.trim() || null,
          is_active: document.getElementById('editActive').value === '1'
        })
      })
      const data = await res.json()
      if (!res.ok) { showToast(data.error, 'error'); return }

      projectData = data.project
      renderProjectHeader(data.project)
      editModal.classList.remove('open')
      showToast('Proyecto actualizado', 'success')
    } catch {
      showToast('Error actualizando', 'error')
    }
  })

  // Eliminar proyecto
  document.getElementById('deleteProjectBtn').addEventListener('click', async () => {
    if (!confirm(`¿Eliminar "${projectData.name}"? Esto borra todas las fotos. No hay vuelta atrás.`)) return

    try {
      const res = await apiJSON(`/admin/projects/${projectId}`, { method: 'DELETE' })
      if (res.ok) {
        showToast('Proyecto eliminado', 'success')
        setTimeout(() => window.location.href = 'dashboard.html', 800)
      } else {
        const data = await res.json()
        showToast(data.error, 'error')
      }
    } catch {
      showToast('Error eliminando', 'error')
    }
  })
}

// ─── Eliminar foto ────────────────────────────────────────────────────────────
async function deletePhoto(photoId) {
  if (!confirm('¿Eliminar esta foto?')) return

  try {
    const res = await apiJSON(`/admin/photos/${photoId}`, { method: 'DELETE' })
    if (res.ok) {
      showToast('Foto eliminada', 'success')
      await loadProject()
    } else {
      const data = await res.json()
      showToast(data.error, 'error')
    }
  } catch {
    showToast('Error eliminando foto', 'error')
  }
}

async function setCover(photoId, isAlreadyCover) {
  try {
    const res = await apiJSON(`/admin/projects/${projectId}/cover`, {
      method: 'PUT',
      body: JSON.stringify({ photo_id: isAlreadyCover ? null : photoId })
    })
    if (!res.ok) { showToast('Error actualizando portada', 'error'); return }
    projectData.cover_photo_id = isAlreadyCover ? null : photoId
    const photos = await apiJSON(`/admin/projects/${projectId}`)
      .then(r => r.json()).then(d => d.photos)
    renderPhotos(photos)
    showToast(isAlreadyCover ? 'Portada eliminada' : 'Portada actualizada', 'success')
  } catch {
    showToast('Error actualizando portada', 'error')
  }
}

function escHtml(str) {
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}
