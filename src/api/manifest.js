import { File, Paths } from 'expo-file-system'

// ExoPlayer loads a manifest (DASH .mpd or a gathered HLS .m3u8) from a URI, so
// the generated one is written to a cache file. One file is enough — only one
// video plays at a time.
export function writeManifest(text, ext = 'mpd') {
  const file = new File(Paths.cache, `yt-${Date.now()}.${ext}`)
  file.write(text)
  for (const old of Paths.cache.list()) {
    if (old instanceof File && /^yt-\d+\.(mpd|m3u8)$/.test(old.name) && old.uri !== file.uri) {
      try {
        old.delete()
      } catch {
        /* noop */
      }
    }
  }
  return file.uri
}
