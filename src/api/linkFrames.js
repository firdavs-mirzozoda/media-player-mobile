// Frames to recognise a film from, taken from a link (Instagram reel, YouTube,
// TikTok, VK, Rutube...). Nothing is downloaded in full:
//   YouTube  -> its auto-generated frames at ~25/50/75% of the video
//   VK       -> preview + a real frame from the middle of the mp4 (native, over http)
//   Rutube   -> video preview
//   anything else -> the link preview (og:image / og:video) the site gives to
//               messengers — this is how Instagram and TikTok links work
import { youtubeId } from './youtube'
import { vkVideoId, vkPlayerParams } from './vk'
import { t } from '../i18n'

// Sites show their link previews to messenger/crawler bots without a login
const BOT_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'

export const isLink = (s) => /^\s*https?:\/\/\S+\s*$/i.test(String(s || ''))

// first http link inside any text (shared texts often look like "Look! https://...")
export function extractLink(s) {
  return String(s || '').match(/https?:\/\/[^\s"'<>]+/i)?.[0] || null
}

function metaContent(html, prop) {
  const a = html.match(
    new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]+)"`, 'i')
  )
  const b = html.match(
    new RegExp(`<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="${prop}"`, 'i')
  )
  return (a || b)?.[1]?.replace(/&amp;/g, '&') || null
}

// Resolves with { images: [http urls, best first], video: progressive mp4 url | null }
export async function getLinkFrames(url) {
  const yt = /youtube\.com|youtu\.be/i.test(url) ? youtubeId(url) : null
  if (yt) {
    return {
      images: ['hq2', 'hq1', 'hq3', 'hqdefault'].map(
        (f) => `https://i.ytimg.com/vi/${yt}/${f}.jpg`
      ),
      video: null
    }
  }

  if (vkVideoId(url)) {
    const p = await vkPlayerParams(url)
    return {
      images: [p.jpg].filter(Boolean),
      video: p.url360 || p.url240 || p.url480 || p.url144 || null
    }
  }

  const rutube = String(url).match(
    /rutube\.ru\/(?:video|shorts)\/(?:private\/)?([a-f0-9]{32})/
  )?.[1]
  if (rutube) {
    const res = await fetch(`https://rutube.ru/api/video/${rutube}/?format=json`)
    const info = res.ok ? await res.json() : null
    return { images: [info?.thumbnail_url].filter(Boolean), video: null }
  }

  const res = await fetch(url, { headers: { 'User-Agent': BOT_UA, 'Accept-Language': 'ru,en' } })
  if (!res.ok) throw new Error(t('errSiteNotOpen', { status: res.status }))
  const html = await res.text()
  const image = metaContent(html, 'og:image') || metaContent(html, 'twitter:image')
  const video = metaContent(html, 'og:video:secure_url') || metaContent(html, 'og:video')
  return {
    images: [image].filter(Boolean),
    video: video && /\.mp4(\?|$)/i.test(video) ? video : null
  }
}
