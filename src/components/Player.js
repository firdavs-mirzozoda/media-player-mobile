import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useEvent } from 'expo'
import { VideoView } from 'expo-video'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  mdiClose,
  mdiDownload,
  mdiFullscreen,
  mdiChevronDown,
  mdiPause,
  mdiPlay,
  mdiSkipNext,
  mdiSkipPrevious,
  mdiVolumeHigh,
  mdiVolumeOff,
  mdiRewind10,
  mdiFastForward10,
  mdiCog
} from '@mdi/js'
import Icon from './Icon'
import SeekBar from './SeekBar'
import { fmtTime } from '../utils'
import { ACCENT } from '../theme'

const HIDE_AFTER = 2600
const DOUBLE_TAP = 280

// dragging the window down this far (or flinging it) turns it into the mini player
const MINIMIZE_DRAG = 120
// the floating mini player: share of the screen width, gap to the screen edges
const MINI_SHARE = 0.56
const MINI_MARGIN = 12
// where the mini player was left — it comes back there next time
let miniSpot = null

function Btn({ path, size = 24, onPress, color = '#fff', style }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.btn, pressed && styles.pressed, style]}
    >
      <Icon path={path} size={size} color={color} />
    </Pressable>
  )
}

// Subscribes to timeUpdate on its own, so the ~2 updates per second re-render
// only the seek bar and the clock — not the video view and controls.
function Progress({ player, onInteract, children }) {
  const tick = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    bufferedPosition: player.bufferedPosition
  })
  const time = tick?.currentTime || 0
  const duration = player.duration || 0
  return (
    <>
      <SeekBar
        time={time}
        duration={duration}
        buffered={tick?.bufferedPosition}
        onInteract={onInteract}
        onSeek={(t) => {
          // eslint-disable-next-line react-hooks/immutability
          player.currentTime = t
        }}
      />
      <View style={styles.row}>
        <Text style={styles.time}>
          {fmtTime(time)} <Text style={styles.dim}>/ {fmtTime(duration)}</Text>
        </Text>
        {children}
      </View>
    </>
  )
}

// Thin accent line along the bottom of the mini player.
function MiniProgress({ player }) {
  const tick = useEvent(player, 'timeUpdate', { currentTime: player.currentTime })
  const duration = player.duration || 0
  const pct = duration ? Math.min(100, ((tick?.currentTime || 0) / duration) * 100) : 0
  return (
    <View style={styles.miniTrack}>
      <View style={{ width: pct + '%', height: '100%', backgroundColor: ACCENT }} />
    </View>
  )
}

export default function Player({
  player,
  theme,
  title,
  mini,
  onToggleMini,
  onClose,
  onPrev,
  onNext,
  muted,
  onToggleMute,
  canDownload,
  onDownloadPress,
  resolving,
  videoKey,
  bottomOffset,
  canPickQuality,
  qualityHeight,
  onQualityPress
}) {
  const insets = useSafeAreaInsets()
  const viewRef = useRef(null)

  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing })
  const { status } = useEvent(player, 'statusChange', { status: player.status })

  /* --- auto-hiding controls --- */
  const [shown, setShown] = useState(true)
  const idle = useRef(0)
  const poke = () => {
    setShown(true)
    clearTimeout(idle.current)
    idle.current = setTimeout(() => {
      if (player.playing) setShown(false)
    }, HIDE_AFTER)
  }
  // while paused the controls stay up (see `visible`); once playing, hide them after a while
  useEffect(() => {
    clearTimeout(idle.current)
    if (isPlaying) idle.current = setTimeout(() => setShown(false), HIDE_AFTER)
    return () => clearTimeout(idle.current)
  }, [isPlaying])

  /* --- tap: toggle controls; double tap left/right: ±10s --- */
  const lastTap = useRef({ t: 0, timer: 0 })
  const surfaceW = useRef(1)
  const [seekFlash, setSeekFlash] = useState(0)
  const onSurfacePress = (e) => {
    const now = e.nativeEvent.timestamp
    const x = e.nativeEvent.locationX
    const w = surfaceW.current
    if (now - lastTap.current.t < DOUBLE_TAP) {
      clearTimeout(lastTap.current.timer)
      lastTap.current.t = 0
      const dir = x < w / 2 ? -1 : 1
      player.seekBy(10 * dir)
      setSeekFlash(dir)
      setTimeout(() => setSeekFlash(0), 500)
      return
    }
    lastTap.current.t = now
    clearTimeout(lastTap.current.timer)
    lastTap.current.timer = setTimeout(() => {
      if (shown && isPlaying) setShown(false)
      else poke()
    }, DOUBLE_TAP)
  }

  const togglePlay = () => {
    if (player.playing) player.pause()
    else player.play()
    poke()
  }

  const buffering = resolving || status === 'loading'
  const visible = shown || !isPlaying

  /* --- drag the window down to minimize it (like YouTube) --- */
  // the pan handlers are created once per layout; they reach the latest callbacks here,
  // so a re-render in the middle of a drag doesn't replace them
  const actions = useRef({})
  actions.current = { onToggleMini, onClose }
  const { width: screenW, height: screenH } = useWindowDimensions()
  const drop = useRef(new Animated.Value(0)).current
  const dropPan = useMemo(
    () =>
      PanResponder.create({
        // only a clearly downward drag — taps, double taps and the seek bar keep working
        onMoveShouldSetPanResponderCapture: (_, g) =>
          g.dy > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
        onPanResponderMove: (_, g) => drop.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > MINIMIZE_DRAG || g.vy > 0.8) {
            Animated.timing(drop, {
              toValue: screenH * 0.6,
              duration: 160,
              useNativeDriver: true
            }).start(() => {
              actions.current.onToggleMini()
              drop.setValue(0)
            })
          } else {
            Animated.spring(drop, { toValue: 0, useNativeDriver: true }).start()
          }
        },
        onPanResponderTerminate: () =>
          Animated.spring(drop, { toValue: 0, useNativeDriver: true }).start()
      }),
    [drop, screenH]
  )

  /* --- the floating mini player: drag it anywhere, it snaps to a side --- */
  const miniW = Math.round(screenW * MINI_SHARE)
  const miniH = Math.round((miniW * 9) / 16)
  const minY = insets.top + MINI_MARGIN
  const maxY = screenH - insets.bottom - miniH - MINI_MARGIN - bottomOffset
  const firstSpot = miniSpot || { x: screenW - miniW - MINI_MARGIN, y: maxY - 60 }
  const spot = useRef(new Animated.ValueXY(firstSpot)).current
  const spotNow = useRef(firstSpot)
  useEffect(() => {
    const id = spot.addListener((v) => (spotNow.current = v))
    return () => spot.removeListener(id)
  }, [spot])
  const miniPan = useMemo(
    () =>
      PanResponder.create({
        // a tap still reaches the buttons; any real movement drags the window
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
        onPanResponderGrant: () => {
          spot.setOffset(spotNow.current)
          spot.setValue({ x: 0, y: 0 })
        },
        onPanResponderMove: Animated.event([null, { dx: spot.x, dy: spot.y }], {
          useNativeDriver: false
        }),
        onPanResponderRelease: (_, g) => {
          spot.flattenOffset()
          const { x, y } = spotNow.current
          // flung sideways or pushed a third off the screen: close, like YouTube
          // (a finger can't go past the edge, so half off would be hard to reach)
          const off = x < -miniW / 3 || x > screenW - (miniW * 2) / 3
          if (off || (Math.abs(g.vx) > 1.2 && Math.abs(g.dx) > miniW / 4)) {
            const out = (g.vx || g.dx) < 0 ? -miniW - 20 : screenW + 20
            Animated.timing(spot, {
              toValue: { x: out, y },
              duration: 150,
              useNativeDriver: false
            }).start(() => {
              miniSpot = null
              actions.current.onClose()
            })
            return
          }
          const target = {
            x: x + miniW / 2 < screenW / 2 ? MINI_MARGIN : screenW - miniW - MINI_MARGIN,
            y: Math.min(Math.max(y, minY), maxY)
          }
          miniSpot = target
          Animated.spring(spot, { toValue: target, friction: 7, useNativeDriver: false }).start()
        }
      }),
    [spot, miniW, screenW, minY, maxY]
  )

  // Mounted only once the stream is loaded, and re-created for every new video
  // (and when switching between the window and the mini bar), so its surface
  // always attaches to a player that already has frames.
  const video = !resolving ? (
    <VideoView
      key={videoKey + (mini ? ':mini' : ':full')}
      ref={viewRef}
      player={player}
      style={styles.video}
      contentFit={mini ? 'cover' : 'contain'}
      surfaceType="textureView"
      nativeControls={false}
      fullscreenOptions={{ enable: true, orientation: 'landscape' }}
      allowsPictureInPicture
    />
  ) : null

  /* ---------------- floating mini player (like YouTube) ---------------- */
  if (mini) {
    return (
      <Animated.View
        {...miniPan.panHandlers}
        style={[
          styles.miniWin,
          {
            width: miniW,
            height: miniH,
            shadowColor: theme.shadow,
            transform: spot.getTranslateTransform()
          }
        ]}
      >
        {video}
        {/* tap the picture: back to the full window */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onToggleMini} />
        {buffering ? (
          <View pointerEvents="none" style={styles.center}>
            <ActivityIndicator color="#fff" size="small" />
          </View>
        ) : (
          <View pointerEvents="box-none" style={styles.center}>
            <Pressable onPress={togglePlay} hitSlop={10} style={styles.miniPlay}>
              <Icon path={isPlaying ? mdiPause : mdiPlay} size={24} />
            </Pressable>
          </View>
        )}
        <Pressable onPress={onClose} hitSlop={10} style={styles.miniClose}>
          <Icon path={mdiClose} size={16} />
        </Pressable>
        <MiniProgress player={player} />
      </Animated.View>
    )
  }

  /* ---------------- video window under the search bar ---------------- */
  return (
    <Animated.View
      {...dropPan.panHandlers}
      style={[
        styles.inline,
        {
          transform: [
            { translateY: drop },
            {
              scale: drop.interpolate({
                inputRange: [0, screenH * 0.6],
                outputRange: [1, 0.55],
                extrapolate: 'clamp'
              })
            }
          ]
        }
      ]}
    >
      <View style={styles.stage} onLayout={(e) => (surfaceW.current = e.nativeEvent.layout.width)}>
        {video}

        <Pressable style={StyleSheet.absoluteFill} onPress={onSurfacePress} />

        {seekFlash ? (
          <View
            pointerEvents="none"
            style={[styles.flash, seekFlash < 0 ? { left: '12%' } : { right: '12%' }]}
          >
            <Icon path={seekFlash < 0 ? mdiRewind10 : mdiFastForward10} size={32} />
          </View>
        ) : null}

        {buffering ? (
          <View pointerEvents="none" style={styles.center}>
            <View style={styles.spinner}>
              <ActivityIndicator color="#fff" size="large" />
            </View>
          </View>
        ) : visible ? (
          <View pointerEvents="box-none" style={styles.center}>
            <View style={styles.centerRow}>
              <Btn path={mdiSkipPrevious} size={30} onPress={() => (onPrev(), poke())} />
              <Pressable onPress={togglePlay} style={styles.bigPlay}>
                <Icon path={isPlaying ? mdiPause : mdiPlay} size={34} />
              </Pressable>
              <Btn path={mdiSkipNext} size={30} onPress={() => (onNext(), poke())} />
            </View>
          </View>
        ) : null}

        {visible ? (
          <>
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(0,0,0,0.7)', 'transparent']}
              style={[styles.scrim, { top: 0, height: 70 }]}
            />
            <View style={styles.top} pointerEvents="box-none">
              <Btn path={mdiChevronDown} size={26} onPress={onToggleMini} />
              <Text numberOfLines={1} style={styles.title}>
                {title}
              </Text>
              <Btn path={mdiClose} size={22} onPress={onClose} />
            </View>

            <LinearGradient
              pointerEvents="none"
              colors={['transparent', 'rgba(0,0,0,0.85)']}
              style={[styles.scrim, { bottom: 0, height: 100 }]}
            />
            <View style={styles.bottom} pointerEvents="box-none">
              <Progress player={player} onInteract={poke}>
                <View style={{ flex: 1 }} />
                {canPickQuality ? (
                  <Pressable
                    hitSlop={8}
                    onPress={() => (onQualityPress(), poke())}
                    style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
                  >
                    <Icon path={mdiCog} size={21} />
                    {qualityHeight >= 720 ? <Text style={styles.hdBadge}>HD</Text> : null}
                  </Pressable>
                ) : null}
                <Btn
                  path={muted ? mdiVolumeOff : mdiVolumeHigh}
                  size={21}
                  onPress={() => (onToggleMute(), poke())}
                />
                {canDownload ? (
                  <Btn path={mdiDownload} size={21} onPress={() => (onDownloadPress(), poke())} />
                ) : null}
                <Btn
                  path={mdiFullscreen}
                  size={23}
                  onPress={() => viewRef.current?.enterFullscreen().catch(() => {})}
                />
              </Progress>
            </View>
          </>
        ) : null}
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  // the 'window' the video plays in, right under the search bar (like the desktop app)
  inline: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    overflow: 'hidden',
    zIndex: 10,
    elevation: 10
  },
  video: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  stage: { flex: 1, backgroundColor: '#000' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 32 },
  bigPlay: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  spinner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(20,20,20,0.5)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  flash: {
    position: 'absolute',
    top: '50%',
    marginTop: -30,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  scrim: { position: 'absolute', left: 0, right: 0 },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingTop: 4,
    gap: 2
  },
  title: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 4
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 10,
    paddingBottom: 2
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  time: { color: '#fff', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dim: { color: 'rgba(255,255,255,0.6)', fontWeight: '400' },
  btn: { padding: 8, borderRadius: 999 },
  hdBadge: {
    position: 'absolute',
    top: 3,
    right: 0,
    paddingHorizontal: 3,
    borderRadius: 3,
    backgroundColor: ACCENT,
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
    lineHeight: 12,
    overflow: 'hidden'
  },
  pressed: { backgroundColor: 'rgba(255,255,255,0.16)', transform: [{ scale: 0.92 }] },

  miniWin: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#000',
    zIndex: 100,
    elevation: 14,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 }
  },
  miniPlay: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  miniClose: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  miniTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(128,128,128,0.25)'
  }
})
