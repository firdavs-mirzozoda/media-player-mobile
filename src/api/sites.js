import { Platform } from 'react-native'
import { isMuxAvailable } from '../../modules/media-muxer'
import { youtubeSearch, youtubeStream, youtubeDownloadTracks } from './youtube'
import { writeManifest } from './manifest'
import { vkSearch, vkStream, vkDownloadPlan } from './vk'
import { t } from '../i18n'

const UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'

export const YOUTUBE_SITE = {
  id: 'youtube',
  name: 'YouTube',
  builtin: true,
  homeUrl: 'https://www.youtube.com',
  search: { mode: 'youtube' }
}

// Rutube exposes a clean JSON search API.
export const RUTUBE_SITE = {
  id: 'rutube',
  name: 'Rutube',
  builtin: true,
  homeUrl: 'https://rutube.ru',
  search: {
    mode: 'api',
    apiUrl: 'https://rutube.ru/api/search/video/?query={q}&page={page}&format=json',
    resultsPath: 'results',
    map: { id: 'video_url', title: 'title', img: 'thumbnail_url', duration: 'duration' }
  }
}

// VK works without a token, through vk.com's own web endpoints (see vk.js).
export const VK_SITE = {
  id: 'vk',
  get name() {
    return t('siteVk')
  },
  builtin: true,
  homeUrl: 'https://vkvideo.ru',
  search: { mode: 'vk' }
}

export const BUILTIN_SITES = [YOUTUBE_SITE, RUTUBE_SITE, VK_SITE]
export const BUILTIN_IDS = BUILTIN_SITES.map((s) => s.id)

export function siteKind(site) {
  if (!site) return null
  if (site.search?.mode === 'youtube' || site.id === 'youtube') return 'youtube'
  if (site.id === 'rutube') return 'rutube'
  if (site.id === 'vk') return 'vk'
  return 'custom'
}

/* ------------------------------------------------------------------ */

export function getPath(obj, path) {
  if (!path) return obj
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc == null ? acc : acc[key]), obj)
}

export function fmtDuration(v) {
  if (v == null || v === '') return '-:--'
  if (typeof v === 'string' && !/^\d+$/.test(v.trim())) return v.trim()
  let s = Math.floor(Number(v))
  if (!isFinite(s) || s < 0) return '-:--'
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  const pad = (n) => (n < 10 ? '0' + n : '' + n)
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

async function getJson(url) {
  let origin = ''
  try {
    origin = new URL(url).origin
  } catch {
    /* noop */
  }
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'ru,en;q=0.9',
      ...(origin ? { Referer: origin + '/' } : {})
    }
  })
  if (!res.ok) throw new Error(t('errHttpFrom', { status: res.status, origin }))
  return res.json()
}

const PAGE_SIZE = 40

async function searchViaApi(site, query, page) {
  const cfg = site.search
  if (cfg.apiUrl.includes('{token}') && !String(site.token || '').trim()) {
    throw new Error(t('errNeedToken'))
  }
  const apiUrl = cfg.apiUrl
    .replace('{q}', encodeURIComponent(query))
    .replace('{page}', String(page))
    .replace('{offset}', String((page - 1) * PAGE_SIZE))
    .replace('{token}', encodeURIComponent(String(site.token || '').trim()))
  const json = await getJson(apiUrl)
  if (json && json.error) {
    throw new Error(json.error.error_msg || json.error.message || 'API error')
  }
  const arr = getPath(json, cfg.resultsPath)
  if (!Array.isArray(arr)) throw new Error(t('errResultsPath'))
  const map = cfg.map || {}
  // idTemplate: "https://site/video{owner_id}_{id}" with {field} placeholders
  // filled from the item — for APIs that don't return a ready video URL.
  const itemId = (r) =>
    map.idTemplate
      ? map.idTemplate.replace(/\{([^}]+)\}/g, (_, k) => {
          const v = getPath(r, k.trim())
          return v == null ? '' : String(v)
        })
      : String(getPath(r, map.id) || '')
  return arr
    .map((r) => ({
      id: itemId(r),
      title: String(getPath(r, map.title) || '').trim(),
      img: String(getPath(r, map.img) || ''),
      durations: fmtDuration(map.duration ? getPath(r, map.duration) : '')
    }))
    .filter((v) => v.id && !/\{[^}]+\}/.test(v.id))
}

// cursor: undefined for a fresh search; whatever the previous call returned as
// `next` for "load more". Returns { videos, next } — next === null means no more.
export async function searchSite(site, query, cursor) {
  if (siteKind(site) === 'youtube') return youtubeSearch(query, cursor)
  if (siteKind(site) === 'vk') return vkSearch(query, cursor)
  const cfg = site.search || {}
  if (cfg.mode !== 'api') throw new Error(t('errApiOnly'))
  const page = cursor || 1
  const videos = await searchViaApi(site, query, page)
  const pageable = /\{(page|offset)\}/.test(cfg.apiUrl)
  return { videos, next: pageable && videos.length ? page + 1 : null }
}

/* ------------------------------------------------------------------ *
 *  Streams — what yt-dlp did on desktop, per site
 * ------------------------------------------------------------------ */

function isDirectMedia(u) {
  return /\.(m3u8|mp4|webm|m4v|mov)(\?|#|$)/i.test(u)
}

async function rutubeMaster(url) {
  const id = String(url).match(/video\/(?:private\/)?([a-f0-9]{32})/)?.[1]
  if (!id) throw new Error(t('errBadRutube'))
  const o = await getJson(
    `https://rutube.ru/api/play/options/${id}/?no_404=true&referer=https%3A%2F%2Frutube.ru&pver=v2`
  )
  const m3u8 = o?.video_balancer?.m3u8 || o?.live_streams?.hls?.[0]?.url
  if (!m3u8) throw new Error(o?.detail?.languages?.[0]?.title || t('errUnavailable'))
  return m3u8
}

async function rutubeStream(url) {
  return { uri: await rutubeMaster(url), contentType: 'hls' }
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.text()
}

// Rutube only streams HLS: every quality is a playlist of MPEG-TS segments that
// already carry video + audio. The download joins the segments of the chosen
// quality and repackages them into an mp4 (see download.js).
async function rutubeDownloadPlan(url, quality) {
  const master = await rutubeMaster(url)
  const lines = (await getText(master)).split('\n').map((l) => l.trim())
  const variants = []
  lines.forEach((l, i) => {
    if (!l.startsWith('#EXT-X-STREAM-INF')) return
    const height = Number(l.match(/RESOLUTION=\d+x(\d+)/)?.[1]) || 0
    if (lines[i + 1]) variants.push({ height, url: new URL(lines[i + 1], master).href })
  })
  if (!variants.length) throw new Error(t('errRutubeNoQualities'))
  const want = Number(quality) || 720
  const lower = variants.filter((v) => v.height <= want).sort((a, b) => b.height - a.height)
  const chosen = lower[0] || variants.sort((a, b) => a.height - b.height)[0]

  const playlist = (await getText(chosen.url)).split('\n').map((l) => l.trim())
  if (playlist.some((l) => l.startsWith('#EXT-X-KEY') && !/METHOD=NONE/.test(l))) {
    throw new Error(t('errRutubeProtected'))
  }
  const segments = playlist
    .filter((l) => l && !l.startsWith('#'))
    .map((s) => new URL(s, chosen.url).href)
  if (!segments.length) throw new Error(t('errRutubeEmpty'))
  return { hls: { segments }, headers: { 'User-Agent': UA }, quality: String(chosen.height) }
}

export async function getStream(site, item) {
  switch (siteKind(site)) {
    case 'youtube': {
      // DASH is Android-only (ExoPlayer); iOS falls back to HLS / 360p mp4
      const s = await youtubeStream(item.id, { dash: Platform.OS === 'android' })
      if (s.mpd) return { uri: writeManifest(s.mpd), contentType: 'dash', headers: s.headers }
      return s
    }
    case 'rutube':
      return rutubeStream(item.id)
    case 'vk':
      return vkStream(item.id)
    default:
      if (isDirectMedia(item.id)) {
        return { uri: item.id, contentType: /\.m3u8/i.test(item.id) ? 'hls' : 'progressive' }
      }
      throw new Error(t('errDirectLink'))
  }
}

// Qualities offered for download. YouTube tracks get merged on the phone
// (Android MediaMuxer); Rutube HLS segments get joined and repackaged to mp4.
export function downloadQualities(site, item) {
  switch (siteKind(site)) {
    case 'youtube':
      return isMuxAvailable ? ['1080', '720', '480', '360', 'audio'] : ['audio']
    case 'vk':
    case 'rutube':
      return ['1080', '720', '480', '360']
    default:
      return item && /\.(mp4|webm|m4v|mov)(\?|#|$)/i.test(item.id) ? ['orig'] : []
  }
}

// What to fetch for a download:
//   { single: { uri }, quality }              — one ready file
//   { video, audio, headers, quality }        — two tracks to merge
//   { audio, headers }                        — audio only (m4a)
//   { hls: { segments }, headers, quality }   — HLS segments to join (Rutube)
export async function getDownloadPlan(site, item, quality) {
  switch (siteKind(site)) {
    case 'youtube':
      return youtubeDownloadTracks(item.id, quality)
    case 'vk':
      return vkDownloadPlan(item.id, quality)
    case 'rutube':
      return rutubeDownloadPlan(item.id, quality)
    default:
      return { single: { uri: item.id }, quality: '' }
  }
}
