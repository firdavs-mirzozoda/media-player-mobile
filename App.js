import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  FlatList,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useEventListener } from 'expo'
import { useVideoPlayer } from 'expo-video'
import { useAudioRecorder, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio'
import * as ImagePicker from 'expo-image-picker'
import * as Clipboard from 'expo-clipboard'
import { File, Paths } from 'expo-file-system'
import {
  mdiChevronDown,
  mdiClose,
  mdiCog,
  mdiDownload,
  mdiHistory,
  mdiMagnify,
  mdiMicrophone,
  mdiMovieSearch,
  mdiOpenInNew,
  mdiVolumeHigh,
  mdiVolumeOff,
  mdiWeatherNight,
  mdiWhiteBalanceSunny
} from '@mdi/js'

import Icon from './src/components/Icon'
import Player from './src/components/Player'
import VideoCard from './src/components/VideoCard'
import QualitySheet from './src/components/QualitySheet'
import MovieSheet from './src/components/MovieSheet'
import PlaybackQualitySheet from './src/components/PlaybackQualitySheet'
import Downloads from './src/components/Downloads'
import { useDownloads } from './src/useDownloads'
import SettingsModal from './src/components/SettingsModal'
import { BUILTIN_SITES, downloadQualities, getStream, searchSite } from './src/api/sites'
import { recognize } from './src/api/shazam'
import { findFilmByImage, findFilmInFrames } from './src/api/movieFinder'
import { getLinkFrames, extractLink } from './src/api/linkFrames'
import { frameAt, pinVideoHeight } from './modules/media-muxer'
import { loadAll, save } from './src/storage'
import { ACCENT, DANGER, THEMES } from './src/theme'
import { LangContext, deviceLang, setLang, t } from './src/i18n'

const SHAZAM_MIN_MS = 3000 // don't let an early second tap cut the clip too short
const SHAZAM_MAX_MS = 8000 // a few seconds of music is plenty for a Shazam match
// 16 kHz mono AAC — what the Shazam fingerprint is computed from, so no resampling
const SHAZAM_RECORDING = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: 'aac ', audioQuality: 96 },
  web: { mimeType: 'audio/webm', bitsPerSecond: 64000 }
}
const DL_BAR = 90

export default function App() {
  const [stored, setStored] = useState(null)
  useEffect(() => {
    loadAll().then(setStored)
  }, [])

  return (
    <SafeAreaProvider>
      {stored ? (
        <Main stored={stored} />
      ) : (
        <View style={[styles.fill, styles.boot, { backgroundColor: THEMES.dark.bg }]}>
          <ActivityIndicator color={ACCENT} size="large" />
        </View>
      )}
    </SafeAreaProvider>
  )
}

// The selected chip is simply inverted (text colour as background), like the
// filter chips in YouTube itself.
function Chip({ label, icon, active, theme, onPress }) {
  const fg = active ? theme.bg : theme.text
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: active ? theme.text : theme.surface2 },
        pressed && { opacity: 0.7 }
      ]}
    >
      {icon ? <Icon path={icon} size={18} color={fg} /> : null}
      <Text style={[styles.chipText, { color: fg }]}>{label}</Text>
    </Pressable>
  )
}

function RoundBtn({ path, color, onPress, children }) {
  return (
    <Pressable
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.roundBtn,
        pressed && { backgroundColor: 'rgba(128,128,128,0.2)' }
      ]}
    >
      {children || <Icon path={path} size={24} color={color} />}
    </Pressable>
  )
}

function Main({ stored }) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()

  /* ---------------- theme ---------------- */
  const [themeName, setThemeName] = useState(stored.theme === 'light' ? 'light' : 'dark')

  /* ---------------- language ---------------- */
  // t() reads the module-level language; LangContext re-renders the components
  const [lang, setLangState] = useState(() => {
    const first = stored.lang || deviceLang()
    setLang(first)
    return first
  })
  const changeLang = (next) => {
    setLang(next)
    setLangState(next)
    save('lang', next)
  }
  const theme = THEMES[themeName]
  const toggleTheme = () => {
    const next = themeName === 'dark' ? 'light' : 'dark'
    setThemeName(next)
    save('theme', next)
  }

  /* ---------------- sites ---------------- */
  // userSites = the persisted list; a user entry whose id matches a built-in
  // overrides that built-in (so built-ins can be tweaked and reset).
  const [userSites, setUserSitesState] = useState(Array.isArray(stored.sites) ? stored.sites : [])
  const setUserSites = (list) => {
    setUserSitesState(list)
    save('sites', list)
  }
  const sites = useMemo(() => {
    const merged = BUILTIN_SITES.map((b) => {
      const override = userSites.find((u) => u.id === b.id)
      return override ? { ...override, builtin: false } : b
    })
    for (const u of userSites) if (!merged.some((m) => m.id === u.id)) merged.push(u)
    return merged
  }, [userSites])
  const [activeSiteId, setActiveSiteIdState] = useState(stored.activeSite || 'youtube')
  const setActiveSiteId = (id) => {
    setActiveSiteIdState(id)
    save('activeSite', id)
  }
  const activeSite = sites.find((s) => s.id === activeSiteId) || sites[0]
  const [settingsOpen, setSettingsOpen] = useState(false)

  /* ---------------- search ---------------- */
  const [search, setSearch] = useState('')
  const [focused, setFocused] = useState(false)
  const [history, setHistory] = useState(Array.isArray(stored.searchList) ? stored.searchList : [])
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const cursor = useRef(null)
  const lastQuery = useRef('')
  const searchSeq = useRef(0)
  const listRef = useRef(null)

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (q ? history.filter((h) => h.toLowerCase().includes(q)) : history)
      .slice()
      .reverse()
      .slice(0, 8)
  }, [search, history])

  const removeHistory = (item) => {
    const next = history.filter((h) => h !== item)
    setHistory(next)
    save('searchList', next)
  }

  const runSearch = async (raw, { silent = false } = {}) => {
    const q = String(raw ?? search).trim()
    if (!q) return
    Keyboard.dismiss()
    setFocused(false)
    setSearch(q)
    if (!history.includes(q)) {
      const next = [...history, q]
      setHistory(next)
      save('searchList', next)
    }
    const seq = ++searchSeq.current
    lastQuery.current = q
    cursor.current = null
    setVideos([])
    setLoading(true)
    try {
      const res = await searchSite(activeSite, q)
      if (seq !== searchSeq.current) return
      cursor.current = res.next
      setVideos(res.videos)
      listRef.current?.scrollToOffset({ offset: 0, animated: false })
      if (!res.videos.length && !silent) Alert.alert(t('nothingFound'), t('checkSiteSettings'))
    } catch (err) {
      if (seq !== searchSeq.current || silent) return
      Alert.alert(t('searchFailed'), String(err?.message || err))
    } finally {
      if (seq === searchSeq.current) setLoading(false)
    }
  }

  const loadMore = async () => {
    if (loading || loadingMore || !cursor.current || !lastQuery.current) return
    const seq = searchSeq.current
    setLoadingMore(true)
    try {
      const res = await searchSite(activeSite, lastQuery.current, cursor.current)
      if (seq !== searchSeq.current) return
      cursor.current = res.next
      setVideos((prev) => [...prev, ...res.videos.filter((m) => !prev.some((v) => v.id === m.id))])
    } catch (err) {
      console.warn('load more failed:', err)
      cursor.current = null
    } finally {
      setLoadingMore(false)
    }
  }

  // like YouTube's home feed: open on the last search instead of an empty screen
  useEffect(() => {
    const last = history[history.length - 1]
    if (!last) return
    const t = setTimeout(() => runSearch(last, { silent: true }), 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // switching the source re-runs the current query there
  const firstSite = useRef(true)
  useEffect(() => {
    if (firstSite.current) {
      firstSite.current = false
      return
    }
    if (lastQuery.current) runSearch(lastQuery.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSite.id])

  /* ---------------- toast ---------------- */
  const [toast, setToast] = useState('')
  const [toastOpacity] = useState(() => new Animated.Value(0))
  const toastTimer = useRef(0)
  const showToast = useCallback(
    (msg, ms = 4000) => {
      setToast(msg)
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start()
      clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => {
        Animated.timing(toastOpacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(
          () => setToast('')
        )
      }, ms)
    },
    [toastOpacity]
  )

  /* ---------------- player ---------------- */
  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 0.5
    p.staysActiveInBackground = true
    p.showNowPlayingNotification = true
  })
  const [current, setCurrent] = useState(null) // { item, site }
  const [resolving, setResolving] = useState(false)
  const [mini, setMini] = useState(false)
  const [muted, setMuted] = useState(stored.muted === true)
  const [isPlaying, setIsPlaying] = useState(false)
  const playSeq = useRef(0)

  useEventListener(player, 'playingChange', ({ isPlaying }) => setIsPlaying(isPlaying))
  // the stream can also fail after it started (network drop, expired link...)
  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (status !== 'error') return
    console.warn('playback error:', error?.message)
    showToast(t('playbackError', { msg: error?.message || t('streamUnavailable') }), 6000)
  })

  /* ---------------- quality, like YouTube ----------------
   * HLS/DASH streams hold every quality. maxResolution would re-select the
   * tracks and throw the buffer away (the video stops), so instead the native
   * pinVideoHeight excludes the other variants inside ExoPlayer's adaptive
   * selection — the next segment just arrives in the new quality, like
   * hls.js nextLevel on the desktop. 'auto' = no exclusions.
   */
  const [qualityPref, setQualityPref] = useState(String(stored['quality-pref'] || 'auto'))
  const qualityPrefRef = useRef(qualityPref)
  const [videoTracks, setVideoTracks] = useState([]) // [{ short, portrait }]
  const [trackHeight, setTrackHeight] = useState(0)
  const [qualityOpen, setQualityOpen] = useState(false)

  const shortSide = (t) => Math.min(t?.size?.width || 0, t?.size?.height || 0)

  // label = the shorter side (a vertical 1080x1920 Short is "1080p" too)
  const applyQuality = (pref) => {
    pinVideoHeight(player, pref === 'auto' ? 0 : Number(pref), 5000).catch(() => {})
  }

  useEventListener(player, 'sourceLoad', ({ availableVideoTracks }) => {
    const tracks = (availableVideoTracks || [])
      .filter((t) => t.isSupported !== false && shortSide(t) > 0)
      .map((t) => ({ short: shortSide(t), portrait: t.size.height > t.size.width }))
    setVideoTracks(tracks)
    applyQuality(qualityPrefRef.current)
  })

  // a fixed quality is kept by re-applying: exclusions expire, and every new
  // track selection (seek into a new period, rebuffer) starts without them
  useEffect(() => {
    if (qualityPref === 'auto' || !videoTracks.length) return
    const id = setInterval(() => applyQuality(qualityPref), 2000)
    return () => clearInterval(id)
  }, [qualityPref, videoTracks])
  useEventListener(player, 'videoTrackChange', ({ videoTrack }) =>
    setTrackHeight(shortSide(videoTrack))
  )

  const qualityOptions = useMemo(() => {
    const heights = [...new Set(videoTracks.map((t) => t.short))].sort((a, b) => b - a)
    if (heights.length < 2) return []
    return [
      {
        value: 'auto',
        label: t('qualityAuto'),
        hint:
          qualityPref === 'auto' && trackHeight
            ? t('qualityNow', { h: trackHeight })
            : t('qualityAutoHint')
      },
      ...heights.map((h) => ({ value: String(h), label: h + 'p', hd: h >= 720 }))
    ]
  }, [videoTracks, trackHeight, qualityPref])

  const pickQuality = (value) => {
    // close a moment later: removing the sheet in the middle of the touch lets
    // the tap fall through to the video card underneath on Android
    setTimeout(() => setQualityOpen(false), 150)
    setQualityPref(value)
    qualityPrefRef.current = value
    save('quality-pref', value)
    applyQuality(value)
  }

  useEffect(() => {
    // expo-video players are mutable native objects; this is the documented way to set them

    player.muted = muted
  }, [muted, player])

  const playVideo = async (item) => {
    if (!item?.id) return
    const site = activeSite
    const seq = ++playSeq.current
    setCurrent({ item, site })
    setMini(false)
    // the watch page starts at the top: title + actions, then "Далее"
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: false }))
    setResolving(true)
    player.pause()
    try {
      const src = await getStream(site, item)
      if (seq !== playSeq.current) return
      await player.replaceAsync({
        uri: src.uri,
        contentType: src.contentType,
        headers: src.headers,
        metadata: { title: item.title, artwork: item.img || undefined }
      })
      if (seq !== playSeq.current) return
      player.play()
    } catch (err) {
      if (seq !== playSeq.current) return
      setCurrent(null)
      if (err?.youtubeOnly) {
        Alert.alert(t('youtubeOnlyTitle'), String(err.message), [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('openIn', { site: 'YouTube' }),
            onPress: () => Linking.openURL(item.id).catch(() => {})
          }
        ])
      } else {
        Alert.alert(t('playFailed'), String(err?.message || err))
      }
    } finally {
      if (seq === playSeq.current) setResolving(false)
    }
  }

  const indexOfCurrent = () => (current ? videos.findIndex((v) => v.id === current.item.id) : -1)
  const playNext = () => {
    const i = indexOfCurrent()
    if (i > -1 && i < videos.length - 1) playVideo(videos[i + 1])
  }
  const playPrev = () => {
    const i = indexOfCurrent()
    if (i > 0) playVideo(videos[i - 1])
  }
  const playNextRef = useRef(playNext)
  useEffect(() => {
    playNextRef.current = playNext
  })
  useEventListener(player, 'playToEnd', () => playNextRef.current())

  const closePlayer = () => {
    playSeq.current++
    player.pause()
    player.replaceAsync(null).catch(() => {})
    setCurrent(null)
    setResolving(false)
  }

  const onCardPress = (item) => {
    if (current && current.item.id === item.id) {
      if (mini) setMini(false)
      else if (player.playing) player.pause()
      else player.play()
    } else playVideo(item)
  }

  /* ---------------- downloads ---------------- */
  const [dlTarget, setDlTarget] = useState(null) // { item, site, qualities } -> bottom sheet
  const onDownloadDone = useCallback(
    (job, res) => {
      const key =
        (res.audioOnly ? 'audio' : 'video') + (res.savedToGallery ? 'Saved' : 'SavedNoGallery')
      showToast(t(key))
    },
    [showToast]
  )
  const onDownloadError = useCallback((job, err) => {
    Alert.alert(t('downloadFailed'), job.item.title + '\n\n' + String(err?.message || err))
  }, [])
  const downloads = useDownloads({ onDone: onDownloadDone, onError: onDownloadError })

  const askDownload = (item, site = activeSite) => {
    const qualities = downloadQualities(site, item)
    if (!qualities.length) return showToast(t('noDownloadHere'))
    setDlTarget({ item, site, qualities })
  }

  const startDownload = (item, quality, site) => {
    const busy = downloads.jobs.length
    if (!downloads.add(item, quality, site)) return showToast(t('alreadyDownloading'))
    showToast(busy ? t('queued') : t('downloadStarted'), 2500)
  }

  /* ---------------- shazam ---------------- */
  const recorder = useAudioRecorder(SHAZAM_RECORDING)
  const [shazamState, setShazamState] = useState('idle') // 'idle' | 'listening' | 'recognizing'
  const shazamTimer = useRef(0)
  const shazamStarted = useRef(0)
  const [pulse] = useState(() => new Animated.Value(1))

  useEffect(() => {
    if (shazamState !== 'listening') {
      pulse.stopAnimation()
      pulse.setValue(1)
      return
    }
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.18, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true })
      ])
    ).start()
  }, [shazamState, pulse])

  const finishShazam = async () => {
    clearTimeout(shazamTimer.current)
    setShazamState('recognizing')
    try {
      await recorder.stop()
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
      const uri = recorder.uri
      if (!uri) throw new Error(t('emptyRecording'))
      const result = await recognize(uri)
      if (result && result.title) {
        showToast(
          t('songFound', { song: [result.artist, result.title].filter(Boolean).join(' – ') })
        )
        // start the search right away so the found track comes up
        runSearch([result.artist, result.title].filter(Boolean).join(' '))
      } else {
        showToast(t('notHeard'), 5000)
      }
    } catch (err) {
      showToast(t('recognizeError', { msg: String(err?.message || err) }), 6000)
    } finally {
      setShazamState('idle')
    }
  }

  const onShazamPress = async () => {
    if (shazamState === 'listening') {
      if (Date.now() - shazamStarted.current >= SHAZAM_MIN_MS) finishShazam()
      return
    }
    if (shazamState !== 'idle') return
    const perm = await requestRecordingPermissionsAsync()
    if (!perm.granted) return Alert.alert(t('noMic'))
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      await recorder.prepareToRecordAsync()
      recorder.record()
    } catch (err) {
      return Alert.alert(t('recordFailed'), String(err?.message || err))
    }
    shazamStarted.current = Date.now()
    setShazamState('listening')
    shazamTimer.current = setTimeout(finishShazam, SHAZAM_MAX_MS)
  }

  /* ---------------- 🎬 find the film by a frame or a link ---------------- */
  const [finder, setFinder] = useState(null) // MovieSheet state

  // 🎬 opens the sheet; a link already in the clipboard is filled in for you
  const onFindFilm = async () => {
    setFinder({ stage: 'input', link: '' })
    try {
      const link = extractLink(await Clipboard.getStringAsync())
      if (link) setFinder((f) => (f && f.stage === 'input' && !f.link ? { ...f, link } : f))
    } catch {
      /* clipboard unavailable */
    }
  }

  const pasteLink = async () => {
    try {
      const link = extractLink(await Clipboard.getStringAsync())
      if (link) setFinder((f) => f && { ...f, link })
      else showToast(t('noLinkInClipboard'))
    } catch {
      showToast(t('clipboardFailed'))
    }
  }

  const fileBytes = async (uri) =>
    uri.startsWith('http')
      ? new Uint8Array(await (await fetch(uri)).arrayBuffer())
      : new File(uri).bytes()

  const findFilmByLink = async () => {
    const link = extractLink(finder?.link)
    if (!link) return showToast(t('pasteLink'))
    Keyboard.dismiss()
    setFinder({ stage: 'working', link, preview: null })
    try {
      const { images, video } = await getLinkFrames(link)
      // the previews first (instant); a real frame from the middle of the video
      // only if they didn't name the film — grabbing it over the network can
      // take a while, so it gives up after 20 s
      const frames = images.slice(0, 2).map((img) => async () => img)
      if (video)
        frames.push(async () => {
          const out = new File(Paths.cache, `frame-${Date.now()}.jpg`).uri
          return Promise.race([
            frameAt(video, -1, out),
            new Promise((resolve) => setTimeout(() => resolve(null), 20000))
          ])
        })
      for (const img of images.slice(2)) frames.push(async () => img)
      if (!frames.length) {
        throw new Error(t('noFrameByLink'))
      }
      const result = await findFilmInFrames(frames, fileBytes, (uri) =>
        setFinder((f) => f && { ...f, preview: uri })
      )
      setFinder((f) => ({ ...f, stage: 'done', ...result }))
    } catch (err) {
      setFinder((f) => ({ ...f, stage: 'error', error: String(err?.message || err) }))
    }
  }

  const findFilmFromGallery = async () => {
    const pick = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsEditing: true, // images: crop to the film itself (e.g. off an Instagram screenshot)
      quality: 0.85 // re-encodes images to JPEG
    })
    if (pick.canceled || !pick.assets?.length) return
    const asset = pick.assets[0]
    const isVideo = asset.type === 'video'
    setFinder({ stage: 'working', preview: isVideo ? null : asset.uri })
    try {
      let frameUri = asset.uri
      if (isVideo) {
        frameUri = new File(Paths.cache, `frame-${Date.now()}.jpg`).uri
        await frameAt(asset.uri, -1, frameUri) // a frame from the middle of the clip
        setFinder((f) => f && { ...f, preview: frameUri })
      }
      const bytes = await new File(frameUri).bytes()
      // the clip's sound may be a song from the film — ask Shazam at the same time
      const shortClip = isVideo && (!asset.duration || asset.duration < 5 * 60 * 1000)
      const [film, song] = await Promise.allSettled([
        findFilmByImage(bytes),
        shortClip ? recognize(asset.uri) : Promise.resolve(null)
      ])
      if (film.status === 'rejected') throw film.reason
      setFinder((f) => ({
        ...f,
        preview: frameUri,
        stage: 'done',
        ...film.value,
        song: song.status === 'fulfilled' ? song.value : null
      }))
    } catch (err) {
      setFinder((f) => ({ ...f, stage: 'error', error: String(err?.message || err) }))
    }
  }

  /* ---------------- back button: watch page -> mini player, like YouTube ---------------- */
  const watching = !!current && !mini
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (watching) return (setMini(true), true)
      if (focused) return (Keyboard.dismiss(), setFocused(false), true)
      return false
    })
    return () => sub.remove()
  })

  /* ---------------- layout ---------------- */
  const columns = width >= 1000 ? 3 : width >= 600 ? 2 : 1
  const showSuggest = focused && suggestions.length > 0
  const [headerH, setHeaderH] = useState(150)
  const bottomSpace = insets.bottom + 16 + (downloads.jobs.length ? DL_BAR : 0)

  const renderItem = ({ item }) => {
    const isCurrent = !!current && current.item.id === item.id
    return (
      <View style={{ flex: 1 / columns, paddingHorizontal: 6 }}>
        <VideoCard
          video={item}
          theme={theme}
          source={activeSite.name}
          current={isCurrent}
          playing={isCurrent && isPlaying}
          onPress={() => onCardPress(item)}
          onMenu={downloadQualities(activeSite, item).length ? () => askDownload(item) : null}
        />
      </View>
    )
  }

  // Under the video on the watch page: title, action chips, then "Далее".
  const watchInfo = watching ? (
    <View style={styles.watchInfo}>
      <Text style={[styles.watchTitle, { color: theme.text }]}>{current.item.title}</Text>
      <Text style={[styles.watchMeta, { color: theme.dim }]}>
        {current.site.name} · {current.item.durations}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {downloadQualities(current.site, current.item).length ? (
          <Chip
            theme={theme}
            icon={mdiDownload}
            label={t('download')}
            onPress={() => askDownload(current.item, current.site)}
          />
        ) : null}
        <Chip
          theme={theme}
          icon={muted ? mdiVolumeOff : mdiVolumeHigh}
          label={muted ? t('muted') : t('sound')}
          onPress={() => {
            save('muted', !muted)
            setMuted(!muted)
          }}
        />
        <Chip
          theme={theme}
          icon={mdiChevronDown}
          label={t('minimize')}
          onPress={() => setMini(true)}
        />
        <Chip
          theme={theme}
          icon={mdiOpenInNew}
          label={t('openIn', { site: current.site.name })}
          onPress={() => Linking.openURL(current.item.id).catch(() => {})}
        />
      </ScrollView>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>{t('upNext')}</Text>
    </View>
  ) : null

  const playerView = current ? (
    <Player
      player={player}
      theme={theme}
      title={current.item.title}
      mini={mini}
      onToggleMini={() => setMini((m) => !m)}
      onClose={closePlayer}
      onPrev={playPrev}
      onNext={playNext}
      muted={muted}
      onToggleMute={() => {
        save('muted', !muted)
        setMuted(!muted)
      }}
      canDownload={downloadQualities(current.site, current.item).length > 0}
      onDownloadPress={() => askDownload(current.item, current.site)}
      resolving={resolving}
      videoKey={current.item.id}
      canPickQuality={qualityOptions.length > 0}
      qualityHeight={trackHeight}
      onQualityPress={() => setQualityOpen(true)}
      bottomOffset={0}
    />
  ) : null

  return (
    <LangContext.Provider value={lang}>
      <View style={[styles.fill, { backgroundColor: theme.bg }]}>
        <StatusBar style={watching ? 'light' : theme.status} />

        {watching ? (
          /* ---------- watch page: video sticks to the top ---------- */
          <>
            <View style={{ height: insets.top, backgroundColor: '#000' }} />
            {playerView}
          </>
        ) : (
          /* ---------- home: logo, search, source chips ---------- */
          <View
            onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}
            style={[styles.header, { paddingTop: insets.top + 4, backgroundColor: theme.bg }]}
          >
            <View style={styles.topBar}>
              <Text style={[styles.brand, { color: theme.text }]}>
                media<Text style={{ color: ACCENT }}>.</Text>
              </Text>
              <View style={{ flex: 1 }} />
              <RoundBtn path={mdiMovieSearch} color={theme.text} onPress={onFindFilm} />
              <RoundBtn onPress={onShazamPress}>
                <Animated.View style={{ transform: [{ scale: pulse }] }}>
                  {shazamState === 'recognizing' ? (
                    <ActivityIndicator color={theme.text} />
                  ) : (
                    <Icon
                      path={mdiMicrophone}
                      size={24}
                      color={shazamState === 'listening' ? DANGER : theme.text}
                    />
                  )}
                </Animated.View>
              </RoundBtn>
              <RoundBtn
                path={themeName === 'dark' ? mdiWhiteBalanceSunny : mdiWeatherNight}
                color={theme.text}
                onPress={toggleTheme}
              />
              <RoundBtn path={mdiCog} color={theme.text} onPress={() => setSettingsOpen(true)} />
            </View>

            <View style={[styles.search, { backgroundColor: theme.surface2 }]}>
              <Icon path={mdiMagnify} size={22} color={theme.dim} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onSubmitEditing={() => runSearch()}
                placeholder={t('searchIn', { site: activeSite.name })}
                placeholderTextColor={theme.placeholder}
                returnKeyType="search"
                style={[styles.searchInput, { color: theme.text }]}
              />
              {search ? (
                <Pressable hitSlop={10} onPress={() => setSearch('')}>
                  <Icon path={mdiClose} size={20} color={theme.dim} />
                </Pressable>
              ) : null}
            </View>

            {shazamState === 'listening' ? (
              <Text style={[styles.listening, { color: DANGER }]}>{t('listening')}</Text>
            ) : null}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {sites.map((s) => (
                <Chip
                  key={s.id}
                  theme={theme}
                  label={s.name}
                  active={s.id === activeSite.id}
                  onPress={() => setActiveSiteId(s.id)}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* ---------- feed / "Далее" ---------- */}
        <FlatList
          ref={listRef}
          key={'cols-' + columns}
          data={videos}
          numColumns={columns}
          keyExtractor={(v) => v.id}
          renderItem={renderItem}
          extraData={[current, isPlaying, theme, columns, mini]}
          ListHeaderComponent={watchInfo}
          contentContainerStyle={{
            paddingHorizontal: 6,
            paddingTop: 8,
            paddingBottom: bottomSpace
          }}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={theme.dim} /> : null
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator style={{ marginTop: 80 }} size="large" color={ACCENT} />
            ) : (
              <View style={styles.empty}>
                <Icon path={mdiMagnify} size={40} color={theme.faint} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>{t('emptyTitle')}</Text>
                <Text style={[styles.emptyText, { color: theme.dim }]}>
                  {t('emptyText', { site: activeSite.name })}
                </Text>
              </View>
            )
          }
        />

        {/* ---------- search history ---------- */}
        {showSuggest && !watching ? (
          <View
            style={[
              styles.suggest,
              { top: headerH - 52, backgroundColor: theme.surface, shadowColor: theme.shadow }
            ]}
          >
            {suggestions.map((s) => (
              <Pressable
                key={s}
                style={({ pressed }) => [
                  styles.suggestRow,
                  pressed && { backgroundColor: theme.surface2 }
                ]}
                onPress={() => runSearch(s)}
              >
                <Icon path={mdiHistory} size={20} color={theme.dim} />
                <Text numberOfLines={1} style={{ color: theme.text, flex: 1, fontSize: 15 }}>
                  {s}
                </Text>
                <Pressable hitSlop={10} onPress={() => removeHistory(s)}>
                  <Icon path={mdiClose} size={18} color={theme.faint} />
                </Pressable>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* ---------- download progress (the floating mini player can be moved off it) ---------- */}
        <Downloads
          jobs={downloads.jobs}
          theme={theme}
          bottom={insets.bottom + 10}
          onCancel={downloads.cancel}
        />

        {current && mini ? playerView : null}

        {toast ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.toast, { bottom: bottomSpace - 6, opacity: toastOpacity }]}
          >
            <Text numberOfLines={2} style={styles.toastText}>
              {toast}
            </Text>
          </Animated.View>
        ) : null}

        <PlaybackQualitySheet
          visible={qualityOpen && !!current}
          theme={theme}
          options={qualityOptions}
          pref={qualityPref}
          currentHeight={trackHeight}
          onPick={pickQuality}
          onClose={() => setQualityOpen(false)}
        />

        <MovieSheet
          state={finder}
          theme={theme}
          onClose={() => setFinder(null)}
          onLinkChange={(link) => setFinder((f) => f && { ...f, link })}
          onSubmitLink={findFilmByLink}
          onPaste={pasteLink}
          onPickGallery={findFilmFromGallery}
          onSearch={(q) => {
            setFinder(null)
            if (q) runSearch(q)
          }}
        />

        <QualitySheet
          target={dlTarget}
          theme={theme}
          onClose={() => setDlTarget(null)}
          onPick={(q) => {
            const t = dlTarget
            setDlTarget(null)
            startDownload(t.item, q, t.site)
          }}
        />

        <SettingsModal
          visible={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          sites={sites}
          userSites={userSites}
          setUserSites={setUserSites}
          setActiveSiteId={setActiveSiteId}
          query={search}
          lang={lang}
          onLangChange={changeLang}
        />
      </View>
    </LangContext.Provider>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  boot: { alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 12, zIndex: 10 },
  topBar: { flexDirection: 'row', alignItems: 'center', height: 48 },
  brand: { fontSize: 24, fontWeight: '800', marginLeft: 4, letterSpacing: -1 },
  roundBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center'
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 999,
    paddingHorizontal: 14,
    marginTop: 4
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
  listening: { fontSize: 12, marginTop: 8, textAlign: 'center' },
  chips: { gap: 8, paddingVertical: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 32,
    borderRadius: 8
  },
  chipText: { fontSize: 14, fontWeight: '500' },
  watchInfo: { paddingHorizontal: 6, paddingTop: 4, paddingBottom: 4 },
  watchTitle: { fontSize: 18, fontWeight: '700', lineHeight: 24 },
  watchMeta: { fontSize: 13, marginTop: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginTop: 4, marginBottom: 12 },
  suggest: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 16,
    paddingVertical: 6,
    zIndex: 20,
    elevation: 10,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 14
  },
  empty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 17, fontWeight: '600', marginTop: 12 },
  emptyText: { textAlign: 'center', marginTop: 6, lineHeight: 20 },
  dl: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 16,
    zIndex: 90,
    elevation: 10,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }
  },
  dlTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  dlTitle: { flex: 1, fontSize: 13, fontWeight: '600' },
  dlPct: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dlTrack: { height: 5, borderRadius: 5, overflow: 'hidden' },
  dlFill: { height: '100%', borderRadius: 5 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '88%',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(30,30,41,0.96)',
    zIndex: 200,
    elevation: 20
  },
  toastText: { color: '#fff', fontSize: 14, textAlign: 'center' }
})
