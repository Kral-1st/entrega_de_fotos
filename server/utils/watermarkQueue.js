const batches = new Map() // batchId -> { queue, total, completed, onEach, resolve }

function createBatch(batchId, photos) {
    const state = { queue: [...photos], total: photos.length, completed: 0, onEach: null, resolve: null }
    batches.set(batchId, state)
    return state
}

// Saca la siguiente foto pendiente de cualquier batch activo (el que sea).
function getNextAny() {
    for (const [batchId, state] of batches) {
        if (state.queue.length > 0) {
            return { batchId, ...state.queue.shift() }
        }
    }
    return null
}

function reportDone(batchId, result) {
    const state = batches.get(batchId)
    if (!state) return
        state.completed++
        if (state.onEach) state.onEach(result)
            if (state.completed >= state.total) {
                batches.delete(batchId)
                if (state.resolve) state.resolve()
            }
}

function whenDone(batchId) {
    const state = batches.get(batchId)
    if (!state) return Promise.resolve()
        return new Promise(resolve => { state.resolve = resolve })
}

function setOnEach(batchId, cb) {
    const state = batches.get(batchId)
    if (state) state.onEach = cb
}

module.exports = { createBatch, getNextAny, reportDone, whenDone, setOnEach }
