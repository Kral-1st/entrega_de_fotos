const config = require('../config')

function workerAuth(req, res, next) {
    const secret = req.headers['x-worker-secret']
    if (!secret || secret !== config.worker.secret) {
        return res.status(401).json({ error: 'No autorizado' })
    }
    next()
}

module.exports = workerAuth
