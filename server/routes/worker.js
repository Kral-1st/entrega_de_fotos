const express     = require('express')
const router      = express.Router()
const workerAuth  = require('../middleware/workerAuth')
const watermarkQueue = require('../utils/watermarkQueue')

router.get('/next', workerAuth, (req, res) => {
    const job = watermarkQueue.getNextAny()
    if (!job) return res.status(204).end()
        res.json(job)
})

router.post('/done', workerAuth, express.json(), (req, res) => {
    const { batchId, id, watermarkedFilename, error } = req.body
    watermarkQueue.reportDone(batchId, { id, watermarkedFilename: watermarkedFilename || null, error: error || null })
    res.json({ ok: true })
})

module.exports = router
