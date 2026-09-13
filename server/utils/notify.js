const webpush = require('web-push')
const nodemailer = require('nodemailer')
const { getDb } = require('../db/database')
const config = require('../config')

webpush.setVapidDetails(
    config.notify.vapidSubject,
    config.notify.vapidPublicKey,
    config.notify.vapidPrivateKey
)

const transporter = config.notify.smtpHost
? nodemailer.createTransport({
    host: config.notify.smtpHost,
    port: config.notify.smtpPort,
    secure: config.notify.smtpPort === 465,
    auth: { user: config.notify.smtpUser, pass: config.notify.smtpPass }
})
: null

async function notifyNewPhotos(projectId, { projectName, slug, count }) {
    const db = getDb()
    const subs = db.prepare(
        'SELECT id, channel, target FROM notification_subscribers WHERE project_id = ?'
    ).all(projectId)

    if (subs.length === 0) return

        const url = `${config.domains.frontend}/p/${slug}`
        const title = `${projectName}: ${count} foto${count === 1 ? '' : 's'} nueva${count === 1 ? '' : 's'}`
        const body = 'Ya están listas para ver.'

        for (const sub of subs) {
            try {
                if (sub.channel === 'push') {
                    await webpush.sendNotification(JSON.parse(sub.target), JSON.stringify({ title, body, url }))
                } else if (sub.channel === 'email' && transporter) {
                    await transporter.sendMail({
                        from: config.notify.smtpFrom,
                        to: sub.target,
                        subject: title,
                        html: `<p>${body}</p><p><a href="${url}">${url}</a></p>`
                    })
                }
            } catch (err) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    db.prepare('DELETE FROM notification_subscribers WHERE id = ?').run(sub.id) // suscripción push muerta
                } else {
                    console.error(`[notify] Error mandando a ${sub.channel}:`, err.message)
                }
            }
        }
}

module.exports = { notifyNewPhotos }
