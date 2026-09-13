function renderDownloadWaitPage(slug) {
    return `<!DOCTYPE html>
    <html lang="es">
    <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Preparando tu descarga</title>
    <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        background: #0b0b0d; color: #f2f2f0; font-family: -apple-system, 'Inter', sans-serif;
        min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .card { max-width: 420px; text-align: center; }
    .spinner {
        width: 44px; height: 44px; border: 3px solid rgba(255,255,255,.12); border-top-color: #d97757;
        border-radius: 50%; margin: 0 auto 24px; animation: spin .8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { font-size: 1.3rem; margin-bottom: 10px; font-weight: 600; }
    p { color: #a3a19d; font-size: .9rem; line-height: 1.5; }
    .progress-label { margin-top: 18px; font-size: .85rem; color: #d97757; font-weight: 500; }
    .retry-btn {
        display: none; margin-top: 20px; background: #d97757; color: #0b0b0d; border: none;
        border-radius: 6px; padding: 12px 22px; font-size: .9rem; font-weight: 600; cursor: pointer;
    }
    </style>
    </head>
    <body>
    <div class="card">
    <div class="spinner" id="spinner"></div>
    <h1 id="title">Preparando tu álbum</h1>
    <p id="subtitle">Estamos armando el ZIP con tus fotos. Esto puede tardar un momento si son muchas — no cierres esta pestaña.</p>
    <p class="progress-label" id="progressLabel"></p>
    <button class="retry-btn" id="retryBtn">Reintentar</button>
    </div>

    <script>
    const title = document.getElementById('title')
    const subtitle = document.getElementById('subtitle')
    const progressLabel = document.getElementById('progressLabel')
    const spinner = document.getElementById('spinner')
    const retryBtn = document.getElementById('retryBtn')
    const downloadUrl = window.location.href

    async function poll(retries = 60) {
        let statusRes
        try {
            statusRes = await fetch(downloadUrl + '/status', { credentials: 'include' })
        } catch {
            return showError('No se pudo conectar. Revisa tu conexión.')
        }

        if (!statusRes.ok) {
            const data = await statusRes.json().catch(() => ({}))
            return showError(data.error || 'No se pudo verificar el ZIP.')
        }

        const { ready } = await statusRes.json()

        if (!ready) {
            if (retries <= 0) return showError('Está tardando más de lo normal.')
                progressLabel.textContent = 'Generando el ZIP...'
                setTimeout(() => poll(retries - 1), 4000)
                return
        }

        const res = await fetch(downloadUrl, { headers: { 'Accept': 'application/json' }, credentials: 'include' })

        if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            return showError(data.error || 'No se pudo generar el ZIP.')
        }

        title.textContent = 'Descargando tu álbum'
        subtitle.textContent = ''
        const total = parseInt(res.headers.get('Content-Length') || '0', 10)
        const reader = res.body.getReader()
        const chunks = []
        let received = 0

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
                chunks.push(value)
                received += value.length
                progressLabel.textContent = total > 0
                ? \`\${Math.round((received / total) * 100)}% (\${(received / 1048576).toFixed(1)}/\${(total / 1048576).toFixed(1)} MB)\`
                : \`\${(received / 1048576).toFixed(1)} MB\`
        }

        const blob = new Blob(chunks, { type: 'application/zip' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = '${slug}-fotos.zip'
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)

        spinner.style.display = 'none'
        title.textContent = '¡Listo!'
        subtitle.textContent = 'Tu descarga debería empezar automáticamente.'
        progressLabel.textContent = ''
    }

    function showError(msg) {
        spinner.style.display = 'none'
        title.textContent = 'Algo salió mal'
        subtitle.textContent = msg
        progressLabel.textContent = ''
        retryBtn.style.display = 'inline-block'
    }

    retryBtn.addEventListener('click', () => {
        retryBtn.style.display = 'none'
        spinner.style.display = 'block'
        title.textContent = 'Preparando tu álbum'
        subtitle.textContent = 'Estamos armando el ZIP con tus fotos.'
        poll()
    })

    poll()
    </script>
    </body>
    </html>`
}

module.exports = { renderDownloadWaitPage }
