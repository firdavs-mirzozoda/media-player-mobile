// YouTube without yt-dlp: talk to the InnerTube API directly, the way yt-dlp does.
//  - search: WEB client (same JSON the site itself uses); also yields visitorData
//  - play/download: VISIONOS client + visitorData -> HLS and whole-file tracks.
//    Without visitorData YouTube answers "confirm you're not a bot" for many
//    videos; IOS / ANDROID_VR stay as fallbacks.

import { t } from '../i18n'

const API = 'https://www.youtube.com/youtubei/v1/'

const WEB = { clientName: 'WEB', clientVersion: '2.20250312.04.00', hl: 'ru', gl: 'RU' }

const IOS = {
  client: {
    clientName: 'IOS',
    clientVersion: '20.10.4',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,2',
    osName: 'iPhone',
    osVersion: '18.3.2.22D82',
    hl: 'ru',
    gl: 'RU'
  },
  id: 5,
  ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)'
}

const ANDROID_VR = {
  client: {
    clientName: 'ANDROID_VR',
    clientVersion: '1.60.19',
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    androidSdkVersion: 32,
    osName: 'Android',
    osVersion: '12L',
    hl: 'ru',
    gl: 'RU'
  },
  id: 28,
  ua: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip'
}

const VISIONOS_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const VISIONOS = {
  client: {
    clientName: 'VISIONOS',
    clientVersion: '1.02',
    deviceMake: 'Apple',
    deviceModel: 'RealityDevice17,1',
    userAgent: VISIONOS_UA,
    osName: 'visionOS',
    osVersion: '26.5.23O471',
    hl: 'ru',
    gl: 'RU'
  },
  id: 101,
  ua: VISIONOS_UA,
  needsVisitor: true
}

// Anonymous visitor id YouTube hands out with every response; sending it back
// is what keeps the player API from asking for a sign-in.
let visitorData = null
function rememberVisitor(j) {
  const vd = j?.responseContext?.visitorData
  if (vd) visitorData = vd
}
async function ensureVisitor() {
  if (!visitorData)
    rememberVisitor(await post('search', { context: { client: WEB }, query: 'music' }))
  return visitorData
}

async function post(endpoint, body, headers = {}) {
  const res = await fetch(API + endpoint + '?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error('YouTube HTTP ' + res.status)
  return res.json()
}

export function youtubeId(url) {
  const m = String(url || '').match(/(?:v=|\/shorts\/|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  return m ? m[1] : null
}

function text(t) {
  if (!t) return ''
  if (t.simpleText) return t.simpleText
  return (t.runs || []).map((r) => r.text).join('')
}

function parseItems(items) {
  const videos = []
  let continuation = null
  for (const it of items || []) {
    if (it.continuationItemRenderer) {
      continuation =
        it.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || null
      continue
    }
    for (const c of it.itemSectionRenderer?.contents || []) {
      const v = c.videoRenderer
      if (!v || !v.videoId) continue
      videos.push({
        id: 'https://www.youtube.com/watch?v=' + v.videoId,
        title: text(v.title),
        img: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        durations: text(v.lengthText) || 'LIVE'
      })
    }
  }
  return { videos, continuation }
}

// Returns { videos, next } where next is an opaque token for loading more.
export async function youtubeSearch(query, next) {
  if (next) {
    const j = await post('search', { context: { client: WEB }, continuation: next })
    rememberVisitor(j)
    const items =
      j.onResponseReceivedCommands?.[0]?.appendContinuationItemsAction?.continuationItems
    const r = parseItems(items)
    return { videos: r.videos, next: r.continuation }
  }
  // params = "type: video" filter, so channels/playlists don't show up
  const j = await post('search', { context: { client: WEB }, query, params: 'EgIQAQ%3D%3D' })
  rememberVisitor(j)
  const items =
    j.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents
  const r = parseItems(items)
  return { videos: r.videos, next: r.continuation }
}

async function player(cl, videoId) {
  const vd = cl.needsVisitor ? await ensureVisitor() : null
  return post(
    'player',
    { context: { client: cl.client }, videoId, contentCheckOk: true, racyCheckOk: true },
    {
      'User-Agent': cl.ua,
      'X-Youtube-Client-Name': String(cl.id),
      'X-Youtube-Client-Version': cl.client.clientVersion,
      Origin: 'https://www.youtube.com',
      ...(vd ? { 'X-Goog-Visitor-Id': vd } : {})
    }
  )
}

function assertPlayable(j) {
  const st = j.playabilityStatus || {}
  if (st.status === 'OK') return
  if (st.liveStreamability || /live event|premier/i.test(st.reason || '')) {
    throw Object.assign(new Error(t('errNotStarted')), { notStarted: true })
  }
  throw new Error(st.reason || t('errUnavailable'))
}

const xml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
const codecsOf = (f) => f.mimeType.match(/codecs="([^"]+)"/)?.[1] || ''

function audioTracks(formats) {
  const audio = formats.filter(
    (f) => f.url && f.mimeType.startsWith('audio/mp4') && !f.isDrc && f.initRange
  )
  // multi-language videos: keep the original track only
  const orig = audio.filter((f) => !f.audioTrack || f.audioTrack.audioIsDefault)
  return orig.length ? orig : audio
}

// Builds an on-demand DASH manifest from YouTube's separate video/audio tracks
// so ExoPlayer can play (and adapt between) them — that is how videos without
// an HLS manifest (most music videos) get above 360p without yt-dlp/ffmpeg.
export function buildDashManifest(streamingData) {
  const formats = streamingData?.adaptiveFormats || []
  const video = formats.filter(
    (f) =>
      f.url &&
      f.initRange &&
      f.indexRange &&
      f.mimeType.startsWith('video/mp4') &&
      /^avc1/.test(codecsOf(f)) &&
      f.height <= 1080
  )
  const audio = audioTracks(formats).filter((f) => f.indexRange)
  if (!video.length || !audio.length) return null

  const durMs = Number(video[0].approxDurationMs || audio[0].approxDurationMs || 0)
  const rep = (f, extra) =>
    `<Representation id="${f.itag}" codecs="${codecsOf(f)}" bandwidth="${f.bitrate}"${extra}>` +
    (f.audioChannels
      ? `<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${f.audioChannels}"/>`
      : '') +
    `<BaseURL>${xml(f.url)}</BaseURL>` +
    `<SegmentBase indexRange="${f.indexRange.start}-${f.indexRange.end}">` +
    `<Initialization range="${f.initRange.start}-${f.initRange.end}"/></SegmentBase></Representation>`

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" ' +
    `type="static" minBufferTime="PT1.5S" mediaPresentationDuration="PT${(durMs / 1000).toFixed(3)}S"><Period>` +
    '<AdaptationSet id="0" mimeType="video/mp4" subsegmentAlignment="true">' +
    video
      .map((f) => rep(f, ` width="${f.width}" height="${f.height}" frameRate="${f.fps || 30}"`))
      .join('') +
    '</AdaptationSet><AdaptationSet id="1" mimeType="audio/mp4" subsegmentAlignment="true">' +
    audio.map((f) => rep(f, ` audioSamplingRate="${f.audioSampleRate || 44100}"`)).join('') +
    '</AdaptationSet></Period></MPD>'
  )
}

// YouTube moved many videos (lots of music videos) to its SABR protocol: for
// those the IOS client gives no HLS, and its separate tracks are cut off after
// roughly the first minute without a PO token (403 further into the file).
// So a track set is only used after checking that the end of the file loads.
async function servesWholeFile(f, ua) {
  const size = Number(f.contentLength) || 0
  if (!size) return false
  try {
    const res = await fetch(f.url, {
      headers: { 'User-Agent': ua, Range: `bytes=${size - 2}-${size - 1}` }
    })
    return res.status === 206 || res.status === 200
  } catch {
    return false
  }
}

const bestVideo = (formats, max = 1080) =>
  formats
    .filter(
      (f) =>
        f.url && f.mimeType.startsWith('video/mp4') && /^avc1/.test(codecsOf(f)) && f.height <= max
    )
    .sort((x, y) => y.height - x.height || y.bitrate - x.bitrate)[0]

const bestAudio = (formats) => audioTracks(formats).sort((x, y) => y.bitrate - x.bitrate)[0]

// Tries VISIONOS, then IOS, then ANDROID_VR; returns the first response whose
// tracks load to the end, as { j, client }.
async function fullAccessPlayer(id) {
  let firstError = null
  for (const client of [VISIONOS, IOS, ANDROID_VR]) {
    try {
      const j = await player(client, id)
      assertPlayable(j)
      const formats = j.streamingData?.adaptiveFormats || []
      const probe = bestVideo(formats) || bestAudio(formats)
      if (probe && (await servesWholeFile(probe, client.ua))) return { j, client }
    } catch (e) {
      if (e.notStarted) throw e
      firstError = firstError || e
    }
  }
  throw new Error(
    firstError && /бот|bot/i.test(firstError.message) ? t('errYtBot') : t('errYtAppOnly')
  )
}

// Returns one of
//   { uri, contentType: 'hls' }               — VISIONOS / IOS HLS (works everywhere)
//   { mpd, contentType: 'dash', headers }     — DASH built from whole-file tracks (Android)
//   { uri, contentType: 'progressive', headers } — muxed mp4 (iOS without HLS)
// Throws with youtubeOnly = true when only YouTube's own app can play it.
export async function youtubeStream(url, { dash = true } = {}) {
  const id = youtubeId(url)
  if (!id) throw new Error(t('errBadYoutube'))

  for (const client of [VISIONOS, IOS]) {
    try {
      const j = await player(client, id)
      assertPlayable(j)
      const hls = j.streamingData?.hlsManifestUrl
      if (hls) return { uri: hls, contentType: 'hls', headers: { 'User-Agent': client.ua } }
    } catch (e) {
      if (e.notStarted) throw e
    }
  }

  try {
    const { j, client } = await fullAccessPlayer(id)
    const headers = { 'User-Agent': client.ua }
    const mpd = dash ? buildDashManifest(j.streamingData) : null
    if (mpd) return { mpd, contentType: 'dash', headers }
    const muxed = (j.streamingData?.formats || []).find((f) => f.url)
    if (muxed) return { uri: muxed.url, contentType: 'progressive', headers }
    throw new Error(t('errNoStreamGot'))
  } catch (e) {
    e.youtubeOnly = true
    throw e
  }
}

const track = (f) => ({ uri: f.url, size: Number(f.contentLength) || 0 })

// Same as the desktop: separate video + audio tracks, merged on the phone.
//   quality '1080' | '720' | '480' | '360' -> { video, audio, headers, quality }
//   quality 'audio'                          -> { audio, headers }  (m4a, handy for music)
export async function youtubeDownloadTracks(url, quality) {
  const { j, client } = await fullAccessPlayer(youtubeId(url))
  const formats = j.streamingData?.adaptiveFormats || []
  const headers = { 'User-Agent': client.ua }
  const audio = bestAudio(formats)
  if (!audio) throw new Error(t('errNoAudio'))
  if (quality === 'audio') return { audio: track(audio), headers }
  const video = bestVideo(formats, Number(quality) || 1080)
  if (!video) throw new Error(t('errNoQuality'))
  return { video: track(video), audio: track(audio), headers, quality: String(video.height) }
}
