// "What film is this?" — reverse image search on Yandex Images, which knows
// films and series well (it returns a card with the title, year and plot
// from Kinopoisk). No key needed: the same upload the yandex.ru/images page does.

import { t } from '../i18n'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

// expo's fetch has no RN-style { uri } FormData parts, so the multipart body is
// built by hand from the JPEG bytes.
function multipart(fieldName, fileName, mime, bytes) {
  const boundary = '----media' + Math.random().toString(16).slice(2)
  const enc = new TextEncoder()
  const head = enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`
  )
  const tail = enc.encode(`\r\n--${boundary}--\r\n`)
  const body = new Uint8Array(head.length + bytes.length + tail.length)
  body.set(head, 0)
  body.set(bytes, head.length)
  body.set(tail, head.length + bytes.length)
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

const unescapeHtml = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

function findKey(obj, key, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 12) return undefined
  if (key in obj) return obj[key]
  for (const v of Object.values(obj)) {
    const found = findKey(v, key, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

// Pulls the film card ("cbirObjectResponses") out of the page's embedded
// state and the "Кажется, на изображении" tags out of the markup.
export function parseYandexResults(html) {
  let card = null
  for (const m of html.matchAll(/data-state="([^"]*cbirObjectResponses[^"]*)"/g)) {
    try {
      const responses = findKey(JSON.parse(unescapeHtml(m[1])), 'objectResponses')
      const first = Array.isArray(responses) ? responses.find((r) => r && r.title) : null
      if (first) {
        card = {
          title: String(first.title),
          subtitle: String(first.subtitle || ''),
          description: String(first.description || '')
        }
        break
      }
    } catch {
      /* not this blob */
    }
  }
  const tags = []
  const section = html.match(/class="CbirSection CbirTags"[\s\S]*?<\/section>/)?.[0] || ''
  for (const m of section.matchAll(/class="Button-Text">([^<]+)</g))
    tags.push(unescapeHtml(m[1]).trim())
  return { card, tags }
}

const MAX_FRAMES = 3

// Tries several frames of the same video until Yandex names a film; otherwise
// returns the guesses from all of them. `frames` are functions resolving to an
// image URI (so a frame is only produced when it's needed), `loadBytes` turns
// a URI into a Uint8Array, `onFrame` reports the frame being checked.
export async function findFilmInFrames(frames, loadBytes, onFrame) {
  const tags = []
  let lastError = null
  let preview = null
  for (const getFrame of frames.slice(0, MAX_FRAMES)) {
    try {
      const uri = await getFrame()
      if (!uri) continue
      preview = preview || uri
      onFrame?.(uri)
      const r = await findFilmByImage(await loadBytes(uri))
      if (r.card) return { ...r, preview: uri }
      for (const t of r.tags) if (!tags.includes(t)) tags.push(t)
    } catch (e) {
      lastError = e
    }
  }
  if (!tags.length && lastError) throw lastError
  return { card: null, tags, query: tags[0] || null, preview }
}

// jpegBytes: Uint8Array. Resolves with { card, tags, query } — query is what to
// search for (title + year, or the best tag); null when nothing was recognised.
export async function findFilmByImage(jpegBytes) {
  const { body, contentType } = multipart('upfile', 'frame.jpg', 'image/jpeg', jpegBytes)
  const request = encodeURIComponent(
    JSON.stringify({ blocks: [{ block: 'b-page_type_search-by-image__link' }] })
  )
  const up = await fetch(
    `https://yandex.ru/images/search?rpt=imageview&format=json&request=${request}`,
    { method: 'POST', body, headers: { 'Content-Type': contentType, 'User-Agent': UA } }
  )
  if (!up.ok) throw new Error(t('errYandexHttp', { status: up.status }))
  const params = (await up.json())?.blocks?.[0]?.params
  if (!params?.cbirId) throw new Error(t('errYandexImage'))

  const page = await fetch(
    `https://yandex.ru/images/search?cbir_id=${encodeURIComponent(params.cbirId)}&rpt=imageview` +
      `&url=${encodeURIComponent(params.originalImageUrl)}`,
    { headers: { 'User-Agent': UA, 'Accept-Language': 'ru' } }
  )
  const html = await page.text()
  if (/showcaptcha|SmartCaptcha/i.test(html)) throw new Error(t('errYandexCaptcha'))

  const parsed = parseYandexResults(html)
  let { card } = parsed
  const tags = parsed.tags
  // Yandex also returns cards for plain objects ("African art", a car model...).
  // Only a card with a release year or a film/series mark is treated as a film.
  const year = card?.subtitle.match(/\b(19|20)\d{2}\b/)?.[0]
  const filmLike = /фильм|сериал|мультфильм|аниме|film|series|movie/i.test(
    `${card?.subtitle} ${card?.description}`
  )
  if (card && !year && !filmLike) {
    if (!tags.includes(card.title)) tags.unshift(card.title)
    card = null
  }
  const query = card ? [card.title, year].filter(Boolean).join(' ') : tags[0] || null
  return { card, tags, query }
}
