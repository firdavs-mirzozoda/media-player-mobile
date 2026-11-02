import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { fmtTime } from '../utils'
import { ACCENT } from '../theme'

// Tap or drag to seek. While dragging the knob follows the finger and a time
// bubble shows where the release will land; the actual seek happens on release.
export default function SeekBar({ time, duration, buffered, onSeek, onInteract }) {
  const [width, setWidth] = useState(1)
  const [drag, setDrag] = useState(-1)

  const ratioAt = (x) => Math.min(1, Math.max(0, x / width))

  const pct = drag >= 0 ? drag * 100 : duration ? (time / duration) * 100 : 0
  const bufPct = duration && buffered > 0 ? Math.min(100, (buffered / duration) * 100) : 0

  return (
    <View
      style={styles.hit}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width || 1)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        onInteract?.()
        setDrag(ratioAt(e.nativeEvent.locationX))
      }}
      onResponderMove={(e) => {
        onInteract?.()
        setDrag(ratioAt(e.nativeEvent.locationX))
      }}
      onResponderRelease={(e) => {
        const r = ratioAt(e.nativeEvent.locationX)
        setDrag(-1)
        if (duration) onSeek(r * duration)
      }}
      onResponderTerminate={() => setDrag(-1)}
    >
      <View style={[styles.track, drag >= 0 && styles.trackActive]} pointerEvents="none">
        <View style={[styles.buffered, { width: bufPct + '%' }]} />
        <View style={[styles.fill, { width: pct + '%' }]} />
        <View style={[styles.knob, { left: pct + '%' }, drag >= 0 && styles.knobActive]} />
      </View>
      {drag >= 0 && duration ? (
        <View
          pointerEvents="none"
          style={[styles.bubble, { left: Math.min(width - 56, Math.max(0, drag * width - 28)) }]}
        >
          <Text style={styles.bubbleText}>{fmtTime(drag * duration)}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  hit: { paddingVertical: 14, justifyContent: 'center' },
  track: { height: 4, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)' },
  trackActive: { height: 6 },
  buffered: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.42)'
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 3,
    backgroundColor: ACCENT
  },
  knob: {
    position: 'absolute',
    top: '50%',
    width: 14,
    height: 14,
    marginLeft: -7,
    marginTop: -7,
    borderRadius: 7,
    backgroundColor: ACCENT
  },
  knobActive: { width: 18, height: 18, marginLeft: -9, marginTop: -9, borderRadius: 9 },
  bubble: {
    position: 'absolute',
    bottom: 30,
    width: 56,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(20,20,20,0.9)',
    alignItems: 'center'
  },
  bubbleText: { color: '#fff', fontSize: 12, fontVariant: ['tabular-nums'] }
})
