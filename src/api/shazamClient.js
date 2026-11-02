// Song recognition through Shazam's own (unofficial, free, key-less) endpoint —
// the same one the Shazam app uses. The audio never leaves the phone: only the
// fingerprint computed in shazamSignature.js is sent.
import { shazamSignature } from './shazamSignature'

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    .replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
    .toUpperCase()
}

// samples: Int16Array of 16 kHz mono PCM. Resolves with
// { title, artist, cover } or null when Shazam found nothing.
export async function shazamRecognize(samples) {
  const sig = shazamSignature(samples)
  if (sig.peaks < 10) return null // silence / too quiet to fingerprint

  const url =
    `https://amp.shazam.com/discovery/v5/ru/RU/iphone/-/tag/${uuid()}/${uuid()}` +
    '?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true' +
    '&hubv5minorversion=v5.1&hidelb=true&video=v3'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
        'X-Shazam-Platform': 'IPHONE',
        'X-Shazam-AppVersion': '14.1.0',
        'Accept-Language': 'ru',
        'User-Agent': 'Shazam/3685 CFNetwork/1197 Darwin/20.0.0'
      },
      body: JSON.stringify({
        timezone: 'Europe/Moscow',
        signature: { uri: sig.uri, samplems: sig.samplems },
        timestamp: Date.now(),
        context: {},
        geolocation: {}
      })
    })
    if (!res.ok) throw new Error('Shazam HTTP ' + res.status)
    const json = await res.json()
    const track = json.track
    if (!track || !json.matches?.length) return null
    return {
      title: track.title || '',
      artist: track.subtitle || '',
      cover: track.images?.coverart || ''
    }
  } finally {
    clearTimeout(timer)
  }
}
