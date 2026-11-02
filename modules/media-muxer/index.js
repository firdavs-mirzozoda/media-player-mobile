import { Platform } from 'react-native'
import { requireNativeModule } from 'expo'

const Native = Platform.OS === 'android' ? requireNativeModule('MediaMuxer') : null

export const isMuxAvailable = !!Native

// Merges a video-only and an audio-only mp4/m4a (e.g. YouTube DASH tracks)
// into one playable mp4 — what ffmpeg does on the desktop. Arguments are
// file:// URIs; resolves with outUri.
export function mux(videoUri, audioUri, outUri) {
  if (!Native) throw new Error('Склейка дорожек доступна только на Android')
  return Native.mux(videoUri, audioUri, outUri)
}

// Repackages one file with video + audio (e.g. joined HLS .ts segments) into mp4.
export function remux(inUri, outUri) {
  if (!Native) throw new Error('Пересборка видео доступна только на Android')
  return Native.remux(inUri, outUri)
}

// One video frame as a JPEG file; atMs < 0 = middle of the video.
export function frameAt(uri, atMs, outUri) {
  if (!Native) throw new Error('Доступно только на Android')
  return Native.frameAt(uri, atMs, outUri)
}

// Seamless quality: keeps the player's adaptive selection on `height` for
// `durationMs` (re-apply periodically). Resolves with the pinned height, 0 if
// the stream has no adaptive video, or null where unsupported (iOS).
export async function pinVideoHeight(player, height, durationMs = 4000) {
  if (!Native?.pinVideoHeight) return null
  return Native.pinVideoHeight(player, height, durationMs)
}

// Decodes an audio file to 16 kHz mono signed 16-bit PCM (base64 string).
export function decodePcm16k(uri) {
  if (!Native) throw new Error('Распознавание доступно только на Android')
  return Native.decodePcm16k(uri)
}
