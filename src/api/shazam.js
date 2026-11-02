import { decodePcm16k } from '../../modules/media-muxer'
import { shazamRecognize } from './shazamClient'
import { t } from '../i18n'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LOOKUP = new Uint8Array(128)
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i

function base64ToBytes(s) {
  const len = s.length
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0
  const out = new Uint8Array((len * 3) / 4 - pad)
  let o = 0
  for (let i = 0; i < len; i += 4) {
    const n =
      (LOOKUP[s.charCodeAt(i)] << 18) |
      (LOOKUP[s.charCodeAt(i + 1)] << 12) |
      (LOOKUP[s.charCodeAt(i + 2)] << 6) |
      LOOKUP[s.charCodeAt(i + 3)]
    if (o < out.length) out[o++] = (n >> 16) & 0xff
    if (o < out.length) out[o++] = (n >> 8) & 0xff
    if (o < out.length) out[o++] = n & 0xff
  }
  return out
}

// fileUri: the mic recording made with expo-audio.
// Resolves with { title, artist, cover } or null when nothing matched.
export async function recognize(fileUri) {
  const bytes = base64ToBytes(await decodePcm16k(fileUri))
  const samples = new Int16Array(bytes.buffer, 0, bytes.length >> 1)
  if (samples.length < 16000 * 2) throw new Error(t('errShortRecording'))
  return shazamRecognize(samples)
}
