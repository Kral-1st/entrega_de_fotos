const crypto = require('crypto')
const config = require('../config')

function workerAuth(req, res, next) {
    const secret = req.headers['x-worker-secret'] || ''
    const expected = config.worker.secret || ''

    const secretBuf = Buffer.from(secret)
    const expectedBuf = Buffer.from(expected)

    if (secretBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(secretBuf, expectedBuf)) {
        return res.status(401).json({ error: 'No autorizado' })
    }

    next()
}

module.exports = workerAuth
