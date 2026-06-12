const FRONTEND_BASE = 'https://fotos.carlangas.dpdns.org'

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
const _origDCL = document.addEventListener.bind(document)
loadPortfolio()
const _portfolioInput = document.getElementById('portfolioInput')
if (_portfolioInput) {
  _portfolioInput.addEventListener('change', async () => {
    const files = Array.from(_portfolioInput.files)
    if (!files.length) return
    for (const file of files) {
      const form = new FormData()
      form.append('photo', file)
      try {
        const res = await fetch(`${API_BASE}/portfolio`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${getToken()}` },
          body: form
        })
        if (!res.ok) { const d = await res.json(); showToast(d.error, 'error') }
      } catch { showToast('Error subiendo', 'error') }
    }
    showToast(`${files.length} foto${files.length !== 1 ? 's' : ''} agregada${files.length !== 1 ? 's' : ''}`, 'success')
    loadPortfolio()
    _portfolioInput.value = ''
  })
}
