import { Directory, File, Paths } from 'expo-file-system'
import { Asset, requestPermissionsAsync } from 'expo-media-library'
import { mux, remux } from '../../modules/media-muxer'
import { t } from '../i18n'

// googlevideo answers 403 to whole-file and >~5 MB range requests, so tracks
// are fetched in 4 MB pieces (yt-dlp does the same with --http-chunk-size).
const CHUNK = 4 * 1024 * 1024
const RETRIES = 4

export const CANCELLED = 'cancelled'

// prettier-ignore
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ә: 'a', ғ: 'g', қ: 'q', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i', ӣ: 'i', ӯ: 'u',
  ҷ: 'j', ҳ: 'h', ş: 's', ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ü: 'u', â: 'a', î: 'i', û: 'u',
  é: 'e', è: 'e', ê: 'e', á: 'a', à: 'a', ó: 'o', ò: 'o', í: 'i', ñ: 'n', ß: 'ss'
}

function safeName(s) {
  const ascii = Array.from(String(s || ''))
    .map((ch) => {
      if (ch === 'İ') return 'I'
      const lower = ch.toLowerCase()
      const t = TRANSLIT[lower]
      if (t === undefined) return ch
      return ch === lower ? t : t.charAt(0).toUpperCase() + t.slice(1)
    })
    .join('')
  return (
    ascii
      .replace(/[^A-Za-z0-9-]+/g, '_')
      .replace(/[_-]*-[_-]*/g, '-')
      .replace(/_+/g, '_')
      .replace(/^[_-]+|[_-]+$/g, '')
      .slice(0, 80) || 'video_' + Date.now()
  )
}

function freeFile(dir, base, ext) {
  let file = new File(dir, `${base}.${ext}`)
  for (let n = 2; file.exists; n++) file = new File(dir, `${base}_${n}.${ext}`)
  return file
}

function removeQuietly(...files) {
  for (const f of files) {
    try {
      if (f.exists) f.delete()
    } catch {
      /* noop */
    }
  }
}

function checkCancelled(job) {
  if (job?.cancelled) throw new Error(CANCELLED)
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchChunk(uri, headers, start, end, job) {
  let lastError
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    checkCancelled(job)
    if (attempt) await wait(1000 * attempt) // give a flaky server a moment
    try {
      const res = await fetch(uri, { headers: { ...headers, Range: `bytes=${start}-${end}` } })
      if (res.status === 416) return new Uint8Array(0)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const bytes = new Uint8Array(await res.arrayBuffer())
      // a range cut short would shift everything after it — fetch it again
      if (res.status === 206 && bytes.length && bytes.length < end - start + 1) {
        const total = Number(res.headers.get('content-range')?.split('/')[1])
        if (total > 0 && start + bytes.length < total) throw new Error(t('errIncompleteChunk'))
      }
      return bytes
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

async function downloadInChunks({ uri, size }, headers, dest, onBytes, job) {
  if (dest.exists) dest.delete()
  let pos = 0
  for (;;) {
    checkCancelled(job)
    const end = size ? Math.min(pos + CHUNK, size) - 1 : pos + CHUNK - 1
    const bytes = await fetchChunk(uri, headers, pos, end, job)
    if (!bytes.length) break
    await dest.write(bytes, { append: pos > 0 })
    pos += bytes.length
    onBytes(pos)
    if (size ? pos >= size : bytes.length < CHUNK) break
  }
  if (!pos) throw new Error(t('errEmptyFile'))
}

const CHUNKS_IN_FLIGHT = 4

// A ready file in 4 MB ranges, a few at a time, written strictly in order.
// Slow servers (~0.5 MB/s per connection) drop a long single
// connection ("unexpected end of stream"); a dropped range is just retried, and
// parallel ranges are faster. Returns false when the server ignores Range —
// then the caller falls back to one plain download.
async function downloadRanged(uri, headers, dest, onProgress, job) {
  checkCancelled(job)
  const first = await fetch(uri, { headers: { ...headers, Range: `bytes=0-${CHUNK - 1}` } })
  const total = Number(first.headers.get('content-range')?.split('/')[1])
  if (first.status !== 206 || !(total > 0)) return false
  // later ranges go straight to the file server the link redirected to
  const target = first.url || uri
  if (dest.exists) dest.delete()
  await dest.write(new Uint8Array(await first.arrayBuffer()))
  let written = Math.min(CHUNK, total)
  onProgress((written / total) * 100)

  const starts = []
  for (let pos = CHUNK; pos < total; pos += CHUNK) starts.push(pos)
  const pending = []
  for (let i = 0; i < starts.length; i++) {
    while (pending.length < CHUNKS_IN_FLIGHT && i + pending.length < starts.length) {
      const start = starts[i + pending.length]
      const p = fetchChunk(target, headers, start, Math.min(start + CHUNK, total) - 1, job)
      p.catch(() => {}) // awaited below; avoid unhandled-rejection noise meanwhile
      pending.push(p)
    }
    const bytes = await pending.shift()
    checkCancelled(job)
    if (!bytes.length) throw new Error(t('errServerCut'))
    await dest.write(bytes, { append: true })
    written += bytes.length
    onProgress((written / total) * 100)
  }
  return true
}

async function downloadWhole(uri, headers, dest, onProgress, job) {
  const task = File.createDownloadTask(uri, dest, {
    headers: headers || {},
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) onProgress((bytesWritten / totalBytes) * 100)
    }
  })
  // lets the queue cancel a running single-file download
  if (job) job.abort = () => task.cancel()
  try {
    await task.downloadAsync()
  } catch (e) {
    checkCancelled(job)
    throw e
  }
  checkCancelled(job)
}

const SEGMENTS_IN_FLIGHT = 4

async function fetchSegment(uri, headers, job) {
  let lastError
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    checkCancelled(job)
    try {
      const res = await fetch(uri, { headers })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return new Uint8Array(await res.arrayBuffer())
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

// HLS: fetch the segments a few at a time but append them strictly in order.
async function downloadSegments(segments, headers, dest, onDone, job) {
  if (dest.exists) dest.delete()
  const pending = []
  for (let i = 0; i < segments.length; i++) {
    while (pending.length < SEGMENTS_IN_FLIGHT && i + pending.length < segments.length) {
      const p = fetchSegment(segments[i + pending.length], headers, job)
      p.catch(() => {}) // awaited below; avoid unhandled-rejection noise meanwhile
      pending.push(p)
    }
    const bytes = await pending.shift()
    checkCancelled(job)
    await dest.write(bytes, { append: i > 0 })
    onDone(i + 1)
  }
}

// Downloads into the app's storage, then copies it into the phone's gallery
// (Movies / Music) so it shows up next to the user's other files.
// `job` is the queue entry: setting job.cancelled = true (and calling
// job.abort?.()) stops the download, which then rejects with CANCELLED.
// Several downloads may run at the same time — every one uses its own temp files.
export async function downloadMedia({ plan, title, onProgress, job }) {
  const dir = new Directory(Paths.document, 'downloads')
  if (!dir.exists) dir.create()
  const quality = plan.quality ? '_' + plan.quality + 'p' : ''
  const audioOnly = !plan.single && !plan.video && !plan.hls
  const dest = freeFile(dir, safeName(title) + quality, audioOnly ? 'm4a' : 'mp4')
  const report = (pct) => onProgress?.(Math.min(100, pct))

  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const vTmp = new File(Paths.cache, `dl-${tag}-video${plan.hls ? '.ts' : '.mp4'}`)
  const aTmp = new File(Paths.cache, `dl-${tag}-audio.m4a`)
  try {
    if (plan.single) {
      const ranged = await downloadRanged(plan.single.uri, plan.headers, dest, report, job)
      if (!ranged) await downloadWhole(plan.single.uri, plan.headers, dest, report, job)
    } else if (plan.hls) {
      // HLS segments -> one .ts file -> repackaged mp4 (the last few % are the remux)
      const total = plan.hls.segments.length
      await downloadSegments(
        plan.hls.segments,
        plan.headers,
        vTmp,
        (n) => report((n / total) * 97),
        job
      )
      checkCancelled(job)
      await remux(vTmp.uri, dest.uri)
      report(100)
    } else if (audioOnly) {
      const total = plan.audio.size || 1
      await downloadInChunks(plan.audio, plan.headers, dest, (n) => report((n / total) * 100), job)
    } else {
      // video + audio -> temp files -> merged mp4 (the last few % are the merge)
      const total = (plan.video.size || 1) + (plan.audio.size || 1)
      await downloadInChunks(plan.video, plan.headers, vTmp, (n) => report((n / total) * 97), job)
      await downloadInChunks(
        plan.audio,
        plan.headers,
        aTmp,
        (n) => report(((plan.video.size + n) / total) * 97),
        job
      )
      checkCancelled(job)
      await mux(vTmp.uri, aTmp.uri, dest.uri)
      report(100)
    }
  } catch (e) {
    removeQuietly(dest) // no half-written files in the downloads folder
    throw e
  } finally {
    removeQuietly(vTmp, aTmp)
  }

  try {
    const perm = await requestPermissionsAsync(true)
    if (perm.granted) {
      await Asset.create(dest.uri)
      return { savedToGallery: true, uri: dest.uri, audioOnly }
    }
  } catch (e) {
    console.warn('gallery save failed:', e)
  }
  return { savedToGallery: false, uri: dest.uri, audioOnly }
}
