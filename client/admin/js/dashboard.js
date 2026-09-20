document.addEventListener('DOMContentLoaded', async () => {
  if (!await requireAuth()) return

  loadProjects()

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', () => {
    clearToken()
    window.location.href = 'index.html'
  })

  // Modal nuevo proyecto
  const modal = document.getElementById('newProjectModal')
  document.getElementById('newProjectBtn').addEventListener('click', () => {
    modal.classList.add('open')
    document.getElementById('pName').focus()
  })
  document.getElementById('cancelProjectBtn').addEventListener('click', () => {
    modal.classList.remove('open')
    document.getElementById('newProjectForm').reset()
  })
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('open')
      document.getElementById('newProjectForm').reset()
    }
  })

  // Crear proyecto
  document.getElementById('newProjectForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = document.getElementById('createProjectBtn')
    btn.disabled = true
    btn.innerHTML = '<div class="spinner"></div>'

    const body = {
      name: document.getElementById('pName').value.trim(),
      client_name: document.getElementById('pClient').value.trim(),
      description: document.getElementById('pDesc').value.trim() || undefined,
      pin: document.getElementById('pPin').value.trim() || undefined
    }

    try {
      const res = await apiJSON('/admin/projects', {
        method: 'POST',
        body: JSON.stringify(body)
      })
      const data = await res.json()

      if (!res.ok) {
        showToast(data.error || 'Error creando proyecto', 'error')
        return
      }

      modal.classList.remove('open')
      document.getElementById('newProjectForm').reset()
      showToast('Proyecto creado', 'success')
      // Ir directo al proyecto
      window.location.href = `project.html?id=${data.project.id}`
    } catch {
      showToast('Error de conexión', 'error')
    } finally {
      btn.disabled = false
      btn.textContent = 'Crear proyecto'
    }
  })
})

async function loadProjects() {
  const grid = document.getElementById('projectsGrid')
  const countEl = document.getElementById('projectCount')

  try {
    const res = await apiJSON('/admin/projects')
    const data = await res.json()

    if (!res.ok) {
      grid.innerHTML = `<p style="color:var(--danger-2)">${data.error}</p>`
      return
    }

    const { projects } = data
    countEl.textContent = `${projects.length} proyecto${projects.length !== 1 ? 's' : ''}`

    if (projects.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18M9 21V9"/>
          </svg>
          <p>Sin proyectos aún. Crea el primero.</p>
        </div>
      `
      return
    }

    grid.innerHTML = projects.map(p => `
      <a class="project-card" href="project.html?id=${p.id}">
        <div class="project-card-header">
          <div>
            <div class="project-card-title">${escHtml(p.name)}</div>
            <div class="project-card-client">${escHtml(p.client_name)}</div>
          </div>
          <div class="project-card-badges">
            <span class="badge ${p.is_active ? 'badge--active' : 'badge--inactive'}">
              ${p.is_active ? 'Activo' : 'Inactivo'}
            </span>
            ${p.pin ? '<span class="badge badge--pin">🔒</span>' : ''}
          </div>
        </div>
        ${p.description ? `<p style="font-size:.83rem;color:var(--text-3);margin-top:4px">${escHtml(p.description)}</p>` : ''}
        <div class="project-card-meta">
          <div class="meta-item">
            <strong>${p.photo_count}</strong>
            fotos
          </div>
          <div class="meta-item">
            <strong>${formatDate(p.created_at)}</strong>
            creado
          </div>
        </div>
        <div class="project-card-link">/p/${p.slug}</div>
      </a>
    `).join('')
  } catch {
    grid.innerHTML = `<p style="color:var(--danger-2)">Error cargando proyectos</p>`
  }
}

function escHtml(str) {
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}

// ─── Portafolio ───────────────────────────────────────────────────────────────
async function loadPortfolio() {
  const grid = document.getElementById('portfolioGrid')
  if (!grid) return
  try {
    const res = await apiJSON('/portfolio')
    const data = await res.json()
    const items = data.portfolio || []
    if (items.length === 0) {
      grid.innerHTML = '<p style="color:var(--text-3);font-size:.85rem;padding:20px 0">Sin imágenes aún.</p>'
    } else {
      grid.innerHTML = items.map(item => `
        <div style="position:relative;aspect-ratio:1;border-radius:6px;overflow:hidden;background:var(--bg-3)">
          <img src="${item.url}" style="width:100%;height:100%;object-fit:cover;display:block" loading="lazy">
          <div class="portfolio-overlay" style="position:absolute;inset:0;background:rgba(0,0,0,.55);opacity:0;transition:opacity .15s;display:flex;align-items:center;justify-content:center">
            <button onclick="deletePortfolioItem(${item.id})" style="background:#c0392b;border:none;color:#fff;border-radius:6px;padding:8px 14px;font-size:.8rem;cursor:pointer">Eliminar</button>
          </div>
        </div>
      `).join('')
      grid.querySelectorAll('[class=portfolio-overlay]').forEach(el => {
        el.parentElement.addEventListener('mouseenter', () => el.style.opacity = 1)
        el.parentElement.addEventListener('mouseleave', () => el.style.opacity = 0)
      })
    }
  } catch { grid.innerHTML = '<p style="color:var(--text-3);font-size:.85rem">Error.</p>' }
}

async function deletePortfolioItem(id) {
  if (!confirm('\u00bfEliminar esta foto del portafolio?')) return
  try {
    const res = await apiJSON(`/portfolio/${id}`, { method: 'DELETE' })
    if (res.ok) { showToast('Foto eliminada', 'success'); loadPortfolio() }
    else { const d = await res.json(); showToast(d.error, 'error') }
  } catch { showToast('Error eliminando', 'error') }
}

// Cargar portafolio y setup upload
loadPortfolio()

// Subida del portafolio con cola: barra por foto, 2 a la vez, cancelar y reintentar
;(function setupPortfolioUpload() {
  const input = document.getElementById('portfolioInput')
  if (!input) return
    const addBtn = document.getElementById('portfolioAddBtn')
    const block = document.getElementById('portfolioQueue')
    const text = document.getElementById('portfolioQueueText')
    const list = document.getElementById('portfolioQueueList')
    const retryBtn = document.getElementById('portfolioRetryBtn')
    const closeBtn = document.getElementById('portfolioCloseBtn')

    const CONCURRENCY = 2              // cada foto se redimensiona 3 veces en el server: no conviene subirlo mucho
    const MAX_SIZE = 50 * 1024 * 1024  // mismo tope que multer en server/routes/portfolio.js
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
    let items = []
    let running = false

    const fmtSize = b => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`
    const countState = s => items.filter(i => i.state === s).length

    function setState(item, state, label) {
      item.state = state
      item.row.dataset.state = state
      item.status.textContent = label
      item.status.title = label
      const finished = items.filter(i => ['done', 'error', 'canceled'].includes(i.state)).length
      if (running) text.textContent = `Subiendo fotos — ${finished} de ${items.length}`
    }

    function addItems(files) {
      for (const file of files) {
        const row = document.createElement('div')
        row.className = 'uq-row'
        row.innerHTML = `
        <span class="uq-name"></span>
        <span class="uq-size">${fmtSize(file.size)}</span>
        <div class="progress-bar-wrap"><div class="progress-bar"></div></div>
        <span class="uq-status"></span>
        <button type="button" class="uq-cancel" title="Cancelar">✕</button>`
        const name = row.querySelector('.uq-name')
        name.textContent = file.name
        name.title = file.name
        const item = { file, row, xhr: null, state: 'queued', bar: row.querySelector('.progress-bar'), status: row.querySelector('.uq-status') }
        row.querySelector('.uq-cancel').addEventListener('click', () => cancelItem(item))
        list.appendChild(row)
        items.push(item)
        setState(item, 'queued', 'En cola')
      }
    }

    function cancelItem(item) {
      if (item.state === 'queued') setState(item, 'canceled', 'Cancelada')
        else if (item.state === 'uploading' && item.xhr) item.xhr.abort()
    }

    function uploadOne(item) {
      return new Promise((resolve) => {
        if (!ALLOWED.includes(item.file.type)) { setState(item, 'error', 'Formato no permitido (solo JPG, PNG o WebP)'); return resolve() }
        if (item.file.size > MAX_SIZE) { setState(item, 'error', 'Pesa más de 50 MB'); return resolve() }

        const form = new FormData()
        form.append('photo', item.file)
          const xhr = new XMLHttpRequest()
          item.xhr = xhr
          xhr.open('POST', `${API_BASE}/portfolio`)
          xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`)

          xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable) return
              const pct = Math.round((e.loaded / e.total) * 100)
              item.bar.style.width = `${pct}%`
              item.status.textContent = pct >= 100 ? 'Procesando...' : `${pct}%`
          }
          xhr.onload = () => {
            let data = {}
            try { data = JSON.parse(xhr.responseText) } catch {}
            if (xhr.status === 201 && data.item) {
              item.bar.style.width = '100%'
              setState(item, 'done', 'Listo')
            } else {
              setState(item, 'error', data.error || `Error ${xhr.status}`)
            }
            resolve()
          }
          xhr.onerror = () => { setState(item, 'error', 'Error de red'); resolve() }
          xhr.onabort = () => { setState(item, 'canceled', 'Cancelada'); resolve() }
          xhr.send(form)
      })
    }

    async function runQueue() {
      const pending = items.filter(i => i.state === 'queued')
      let next = 0
      const worker = async () => {
        while (next < pending.length) {
          const item = pending[next++]
          if (item.state !== 'queued') continue // cancelada mientras esperaba
            setState(item, 'uploading', '0%')
            await uploadOne(item)
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker))
    }

    function closeQueue() {
      block.classList.remove('active')
      addBtn.style.display = ''
      list.innerHTML = ''
      items = []
    }

    async function runAndFinish() {
      if (running) return
        running = true
        retryBtn.style.display = 'none'
        closeBtn.textContent = 'Cancelar todo'

        await runQueue()
        running = false

        const done = countState('done')
        const failed = countState('error')
        const canceled = countState('canceled')
        if (done > 0) loadPortfolio()

          const parts = [`${done} subida${done !== 1 ? 's' : ''}`]
          if (failed) parts.push(`${failed} con error`)
            if (canceled) parts.push(`${canceled} cancelada${canceled !== 1 ? 's' : ''}`)
              const msg = parts.join(', ')

              if (failed > 0) {
                // Dejar la lista visible para ver qué falló y poder reintentar
                text.textContent = msg
                retryBtn.style.display = ''
                closeBtn.textContent = 'Cerrar'
              } else {
                closeQueue()
              }
              showToast(msg, failed > 0 ? 'error' : 'success')
    }

    retryBtn.addEventListener('click', () => {
      for (const item of items) {
        if (item.state !== 'error') continue
          item.bar.style.width = '0%'
          setState(item, 'queued', 'En cola')
      }
      runAndFinish()
    })

    closeBtn.addEventListener('click', () => {
      if (running) items.forEach(cancelItem)
        else closeQueue()
    })

    input.addEventListener('change', () => {
      const files = Array.from(input.files)
      input.value = ''
      if (!files.length || running) return
        closeQueue()
        addBtn.style.display = 'none'
        block.classList.add('active')
        addItems(files)
        runAndFinish()
    })
})()
