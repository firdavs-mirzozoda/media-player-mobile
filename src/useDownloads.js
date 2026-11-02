import { useEffect, useSyncExternalStore } from 'react'
import { getDownloadPlan } from './api/sites'
import { CANCELLED, downloadMedia } from './api/download'
import { qualityLabel } from './theme'

const PARALLEL = 2 // downloads running at the same time; the rest wait in the queue
const PROGRESS_EVERY_MS = 300

// Download queue as a plain store outside React: add as many as you like,
// PARALLEL run at once, the rest start automatically as slots free up.
// Components read it through useDownloads() (useSyncExternalStore).
class DownloadQueue {
  jobs = []
  snapshot = []
  listeners = new Set()
  handlers = {}
  lastEmit = 0

  subscribe = (fn) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = () => this.snapshot

  emit() {
    this.lastEmit = Date.now()
    this.snapshot = this.jobs.map((j) => ({ ...j }))
    this.listeners.forEach((fn) => fn())
  }

  // returns false when that exact video+quality is already in the list
  add = (item, quality, site) => {
    const key = item.id + '|' + quality
    if (this.jobs.some((j) => j.key === key)) return false
    this.jobs.push({
      key,
      id: key + '|' + Date.now(),
      item,
      site,
      quality,
      label: qualityLabel(quality),
      status: 'queued',
      pct: 0
    })
    this.pump()
    return true
  }

  cancel = (id) => {
    const job = this.jobs.find((j) => j.id === id)
    if (!job) return
    job.cancelled = true
    job.abort?.()
    if (job.status === 'queued') this.jobs = this.jobs.filter((j) => j !== job)
    this.emit()
  }

  // start queued jobs while there are free slots
  pump() {
    let running = this.jobs.filter((j) => j.status === 'downloading').length
    for (const job of this.jobs) {
      if (running >= PARALLEL) break
      if (job.status !== 'queued') continue
      job.status = 'downloading'
      running++
      this.run(job)
    }
    this.emit()
  }

  async run(job) {
    try {
      const plan = await getDownloadPlan(job.site, job.item, job.quality)
      const res = await downloadMedia({
        plan,
        title: job.item.title,
        job,
        onProgress: (pct) => {
          job.pct = pct
          // a chunk can land every few ms — don't re-render on every one
          if (Date.now() - this.lastEmit > PROGRESS_EVERY_MS) this.emit()
        }
      })
      this.handlers.onDone?.(job, res)
    } catch (e) {
      if (!job.cancelled && String(e?.message) !== CANCELLED) this.handlers.onError?.(job, e)
    } finally {
      this.jobs = this.jobs.filter((j) => j !== job)
      this.pump()
    }
  }
}

const queue = new DownloadQueue()

export function useDownloads({ onDone, onError }) {
  useEffect(() => {
    queue.handlers = { onDone, onError }
  }, [onDone, onError])
  const jobs = useSyncExternalStore(queue.subscribe, queue.getSnapshot)
  return { jobs, add: queue.add, cancel: queue.cancel }
}
 