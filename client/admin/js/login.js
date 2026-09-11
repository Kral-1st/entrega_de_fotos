document.addEventListener('DOMContentLoaded', async () => {
  // Si ya hay token válido, ir al dashboard
  const token = getToken()
  if (token) {
    try {
      const res = await apiFetch('/auth/verify')
      if (res.ok) {
        window.location.href = 'dashboard.html'
        return
      }
    } catch {}
    clearToken()
  }

  const form = document.getElementById('loginForm')
  const errorMsg = document.getElementById('errorMsg')
  const submitBtn = document.getElementById('submitBtn')

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const password = document.getElementById('password').value.trim()

    if (!password) return

    submitBtn.disabled = true
    submitBtn.innerHTML = '<div class="spinner"></div>'
    errorMsg.textContent = ''

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })

      const data = await res.json()

      if (!res.ok) {
        errorMsg.textContent = data.error || 'Error al iniciar sesión'
        return
      }

      setToken(data.token)
      window.location.href = 'dashboard.html'
    } catch {
      errorMsg.textContent = 'Error de conexión con la API'
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = 'Entrar'
    }
  })
})
