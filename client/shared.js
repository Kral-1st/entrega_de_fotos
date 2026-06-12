// Configuración central del frontend
const API_BASE = window.location.hostname === 'server'
? 'http://server:3556'
: 'https://api-fotos.carlangas.dpdns.org'

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('admin_token')
  const headers = { 'Content-Type': 'application/json', ...options.headers }

  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers })

  if (res.status === 401) {
    // Token expirado o inválido - si estamos en admin, redirigir al login
    if (window.location.pathname.includes('/admin/') && !window.location.pathname.includes('index.html')) {
      localStorage.removeItem('admin_token')
      window.location.href = '/admin/index.html'
      return
    }
  }

  return res
}

async function apiJSON(endpoint, options = {}) {
  const res = await apiFetch(endpoint, options)
  return res
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function getToken() {
  return localStorage.getItem('admin_token')
}

function setToken(token) {
  localStorage.setItem('admin_token', token)
}

function clearToken() {
  localStorage.removeItem('admin_token')
}

async function requireAuth() {
  const token = getToken()
  if (!token) {
    window.location.href = '/admin/index.html'
    return false
  }
  try {
    const res = await apiFetch('/auth/verify')
    if (!res.ok) {
      clearToken()
      window.location.href = '/admin/index.html'
      return false
    }
    return true
  } catch {
    window.location.href = '/admin/index.html'
    return false
  }
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('es-MX', {
    year: 'numeric', month: 'long', day: 'numeric'
  })
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast')
  if (existing) existing.remove()

  const toast = document.createElement('div')
  toast.className = `toast toast--${type}`
  toast.textContent = message
  document.body.appendChild(toast)

  requestAnimationFrame(() => toast.classList.add('toast--visible'))
  setTimeout(() => {
    toast.classList.remove('toast--visible')
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}
