// VK Video without an access_token — the same endpoints vk.com's own web
// player uses (and yt-dlp): POST vk.com/al_video.php
//   act=search_video -> search results (paged with offset)
//   act=show         -> player params: url144..url2160 (mp4) and hls

import { t } from '../i18n'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

// The answers come in windows-1251; React Native's TextDecoder only knows UTF-8.
// prettier-ignore
const CP1251_HIGH = [
  0x0402, 0x0403, 0x201a, 0x0453, 0x201e, 0x2026, 0x2020, 0x2021, 0x20ac, 0x2030, 0x0409, 0x2039, 0x040a, 0x040c, 0x040b, 0x040f,
  0x0452, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0xfffd, 0x2122, 0x0459, 0x203a, 0x045a, 0x045c, 0x045b, 0x045f,
  0x00a0, 0x040e, 0x045e, 0x0408, 0x00a4, 0x0490, 0x00a6, 0x00a7, 0x0401, 0x00a9, 0x0404, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x0407,
  0x00b0, 0x00b1, 0x0406, 0x0456, 0x0491, 0x00b5, 0x00b6, 0x00b7, 0x0451, 0x2116, 0x0454, 0x00bb, 0x0458, 0x0405, 0x0455, 0x0457
]

export function decodeCp1251(buffer) {
  const bytes = new Uint8Array(buffer)
  let out = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    const part = []
    const end = Math.min(bytes.length, i + 8192)
    for (let j = i; j < end; j++) {
      const b = bytes[j]
      part.push(b < 0x80 ? b : b >= 0xc0 ? 0x0410 + (b - 0xc0) : CP1251_HIGH[b - 0x80])
    }
    out += String.fromCharCode.apply(null, part)
  }
  return out
}

// Titles carry HTML entities (letters outside cp1251 arrive as &#1179; etc.)
export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .trim()
}

async function alVideo(params) {
  const res = await fetch('https://vk.com/al_video.php', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://vk.com/al_video.php'
    },
    body: new URLSearchParams({ ...params, al: '1' }).toString()
  })
  if (!res.ok) throw new Error('VK HTTP ' + res.status)
  const text = decodeCp1251(await res.arrayBuffer())
  return JSON.parse(text.replace(/^<!--/, ''))
}

export function vkVideoId(url) {
  // vkvideo.ru/video-1_2, vk.com/video-1_2, vk.com/clip-1_2 (clips share the id format)
  const m = String(url || '').match(/(?:video|clip)(-?\d+_\d+)/)
  return m ? m[1] : null
}

// cursor = how many results are already loaded (VK pages by offset).
// Returns { videos, next } — next === null means no more pages.
export async function vkSearch(query, cursor) {
  const offset = cursor || 0
  const j = await alVideo({ act: 'search_video', q: query, ...(offset ? { offset } : {}) })
  const list = (j.payload?.[1] || []).find((x) => x && Array.isArray(x.list))?.list || []
  const videos = list
    .filter((it) => Array.isArray(it) && it[0] != null && it[1] != null)
    .map((it) => ({
      id: `https://vkvideo.ru/video${it[0]}_${it[1]}`,
      title: decodeEntities(it[3]),
      img: String(it[2] || ''),
      durations: String(it[5] || '-:--')
    }))
  return { videos, next: videos.length ? offset + videos.length : null }
}

const QUALITIES = ['2160', '1440', '1080', '720', '480', '360', '240', '144']

export async function vkPlayerParams(url) {
  const id = vkVideoId(url)
  if (!id) throw new Error(t('errBadVk'))
  const j = await alVideo({ act: 'show', video: id })
  const params = (j.payload?.[1] || []).find((x) => x && x.player)?.player?.params?.[0]
  if (!params || !(params.hls || QUALITIES.some((q) => params['url' + q]))) {
    throw new Error(t('errVkPrivate'))
  }
  return params
}

export async function vkStream(url) {
  const p = await vkPlayerParams(url)
  // HLS switches quality by itself as the connection changes
  if (p.hls) return { uri: p.hls, contentType: 'hls', headers: { 'User-Agent': UA } }
  for (const q of QUALITIES) {
    if (p['url' + q])
      return { uri: p['url' + q], contentType: 'progressive', headers: { 'User-Agent': UA } }
  }
  throw new Error(t('errNoStream'))
}

// One ready mp4 at the requested quality, else the next lower one, else the
// closest higher one (some videos only exist in a few qualities).
export async function vkDownloadPlan(url, quality) {
  const p = await vkPlayerParams(url)
  const start = Math.max(0, QUALITIES.indexOf(String(quality)))
  const order = [...QUALITIES.slice(start), ...QUALITIES.slice(0, start).reverse()]
  const q = order.find((x) => p['url' + x])
  if (!q) throw new Error(t('errVkNoMp4'))
  return { single: { uri: p['url' + q] }, headers: { 'User-Agent': UA }, quality: q }
}
