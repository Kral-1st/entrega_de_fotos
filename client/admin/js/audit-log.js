document.addEventListener('DOMContentLoaded', async () => {
    if (!await requireAuth()) return

        loadAuditLog()

        document.getElementById('logoutBtn').addEventListener('click', () => {
            clearToken()
            window.location.href = 'index.html'
        })

        document.getElementById('refreshBtn').addEventListener('click', loadAuditLog)
})

function formatDateTime(isoString) {
    return new Date(isoString + 'Z').toLocaleString('es-MX', {
        dateStyle: 'medium',
        timeStyle: 'short'
    })
}

async function loadAuditLog() {
    const body = document.getElementById('auditBody')
    const countEl = document.getElementById('logCount')

    try {
        const res = await apiJSON('/admin/audit-log')
        const data = await res.json()

        if (!res.ok) {
            body.innerHTML = `<tr><td colspan="6" style="color:var(--danger-2)">${escHtml(data.error)}</td></tr>`
            return
        }

        const { logs } = data
        countEl.textContent = `${logs.length} registro${logs.length !== 1 ? 's' : ''} recientes`

        if (logs.length === 0) {
            body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px 0;color:var(--text-2)">Sin actividad registrada.</td></tr>`
            return
        }

        body.innerHTML = logs.map(l => `
        <tr>
        <td>${formatDateTime(l.created_at)}</td>
        <td><span class="audit-action">${escHtml(l.action)}</span></td>
        <td>${escHtml(l.target_type)}</td>
        <td>${l.target_id ?? '—'}</td>
        <td>${escHtml(l.ip || '—')}</td>
        <td class="audit-detail" title="${escHtml(l.detail || '')}">${escHtml(l.detail || '—')}</td>
        </tr>
        `).join('')
    } catch {
        body.innerHTML = `<tr><td colspan="6" style="color:var(--danger-2)">Error de conexión</td></tr>`
    }
}

function escHtml(str) {
    const d = document.createElement('div')
    d.textContent = String(str)
    return d.innerHTML
}
