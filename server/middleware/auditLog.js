const { getDb } = require('../db/database')

function audit(action, targetType) {
    return (req, res, next) => {
        res.on('finish', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const db = getDb()
                db.prepare(`
                INSERT INTO admin_audit_log (action, target_type, target_id, detail, ip)
                VALUES (?, ?, ?, ?, ?)
                `).run(action, targetType, req.params.id || null, JSON.stringify(req.body || {}), req.ip)
            }
        })
        next()
    }
}

module.exports = audit
