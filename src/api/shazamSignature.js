// Shazam audio fingerprint ("signature"), ported from SongRec / shazamio.
// Input: signed 16-bit mono PCM at 16 kHz. Output: the data URI Shazam's
// recognition endpoint expects.
//
// How it works: every 128 new samples, a Hann-windowed 2048-point FFT is taken
// over the last 2048 samples; spectral peaks that stand out both in frequency
// and over time are kept, grouped into four frequency bands and packed into
// Shazam's binary format.

const SAMPLE_RATE = 16000
const FFT_SIZE = 2048
const BINS = FFT_SIZE / 2 + 1 // 1025
const HOP = 128
const RING = 256

/* ---------------- FFT (radix-2, real input) ---------------- */

const HANN = new Float64Array(FFT_SIZE)
for (let n = 0; n < FFT_SIZE; n++) {
  // numpy.hanning(2050)[1:-1] — a Hann window without the zero end points
  HANN[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (n + 1)) / 2049)
}

const LOG2 = Math.log2(FFT_SIZE)
const REV = new Uint16Array(FFT_SIZE)
for (let i = 0; i < FFT_SIZE; i++) {
  let r = 0
  for (let b = 0; b < LOG2; b++) r |= ((i >> b) & 1) << (LOG2 - 1 - b)
  REV[i] = r
}
const COS = new Float64Array(FFT_SIZE / 2)
const SIN = new Float64Array(FFT_SIZE / 2)
for (let i = 0; i < FFT_SIZE / 2; i++) {
  COS[i] = Math.cos((-2 * Math.PI * i) / FFT_SIZE)
  SIN[i] = Math.sin((-2 * Math.PI * i) / FFT_SIZE)
}

const re = new Float64Array(FFT_SIZE)
const im = new Float64Array(FFT_SIZE)

// |FFT|² / 2^17 of the windowed input, first 1025 bins.
function powerSpectrum(input, out) {
  for (let i = 0; i < FFT_SIZE; i++) {
    re[REV[i]] = input[i] * HANN[i]
    im[REV[i]] = 0
  }
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1
    const step = FFT_SIZE / size
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let k = 0; k < half; k++) {
        const c = COS[k * step]
        const s = SIN[k * step]
        const a = start + k
        const b = a + half
        const tr = re[b] * c - im[b] * s
        const ti = re[b] * s + im[b] * c
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
  for (let i = 0; i < BINS; i++) {
    out[i] = Math.max((re[i] * re[i] + im[i] * im[i]) / (1 << 17), 1e-10)
  }
}

/* ---------------- peak extraction ---------------- */

const NEIGHBORS = [-10, -7, -4, -3, 1, 2, 5, 8]
const OTHER_FFTS = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249]
const mod = (n, m) => ((n % m) + m) % m
const magnitude = (v) => Math.log(Math.max(1 / 64, v)) * 1477.3 + 6144

function bandOf(hz) {
  if (hz >= 250 && hz < 520) return 0
  if (hz >= 520 && hz < 1450) return 1
  if (hz >= 1450 && hz < 3500) return 2
  if (hz >= 3500 && hz <= 5500) return 3
  return -1
}

function extractPeaks(samples) {
  const ring = new Float64Array(FFT_SIZE)
  let ringPos = 0
  const window = new Float64Array(FFT_SIZE)

  const ffts = Array.from({ length: RING }, () => new Float64Array(BINS))
  let fftPos = 0
  const spread = Array.from({ length: RING }, () => new Float64Array(BINS))
  let spreadPos = 0
  let spreadWritten = 0

  const bands = [[], [], [], []]

  for (let off = 0; off + HOP <= samples.length; off += HOP) {
    // --- FFT over the last 2048 samples
    for (let i = 0; i < HOP; i++) ring[ringPos + i] = samples[off + i]
    ringPos = (ringPos + HOP) % FFT_SIZE
    for (let i = 0; i < FFT_SIZE; i++) window[i] = ring[(ringPos + i) % FFT_SIZE]
    const fft = ffts[fftPos]
    powerSpectrum(window, fft)
    fftPos = (fftPos + 1) % RING

    // --- spread peaks over neighbouring bins and the previous FFTs
    const spreadNew = new Float64Array(BINS)
    for (let i = 0; i < BINS; i++) {
      spreadNew[i] = i < BINS - 3 ? Math.max(fft[i], fft[i + 1], fft[i + 2]) : fft[i]
    }
    let acc = spreadNew
    for (const back of [-1, -3, -6]) {
      const idx = mod(spreadPos + back, RING)
      const prev = spread[idx]
      const merged = new Float64Array(BINS)
      for (let i = 0; i < BINS; i++) merged[i] = Math.max(acc[i], prev[i])
      spread[idx] = merged
      acc = merged
    }
    spread[spreadPos] = spreadNew
    spreadPos = (spreadPos + 1) % RING
    spreadWritten++

    if (spreadWritten < 46) continue

    // --- peak recognition on the FFT from 46 steps ago
    const f46 = ffts[mod(fftPos - 46, RING)]
    const s49 = spread[mod(spreadPos - 49, RING)]
    for (let bin = 10; bin < 1015; bin++) {
      const v = f46[bin]
      if (v < 1 / 64 || v < s49[bin - 1]) continue

      let maxN = 0
      for (const n of NEIGHBORS) maxN = Math.max(maxN, s49[bin + n])
      if (v <= maxN) continue

      let maxO = maxN
      for (const o of OTHER_FFTS) maxO = Math.max(maxO, spread[mod(spreadPos + o, RING)][bin - 1])
      if (v <= maxO) continue

      const mag = magnitude(v)
      const before = magnitude(f46[bin - 1])
      const after = magnitude(f46[bin + 1])
      const var1 = mag * 2 - before - after
      if (var1 <= 0) continue
      const var2 = ((after - before) * 32) / var1
      const correctedBin = bin * 64 + var2
      const band = bandOf(correctedBin * (SAMPLE_RATE / 2 / 1024 / 64))
      if (band < 0) continue
      bands[band].push({
        fft: spreadWritten - 46,
        mag: Math.trunc(mag),
        bin: Math.trunc(correctedBin)
      })
    }
  }
  return bands
}

/* ---------------- binary encoding ---------------- */

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}
function crc32(bytes, from) {
  let c = 0xffffffff
  for (let i = from; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)]
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '='
    out += i + 2 < bytes.length ? B64[c & 63] : '='
  }
  return out
}

class Writer {
  bytes = []
  u8(v) {
    this.bytes.push(v & 0xff)
  }
  u16(v) {
    this.u8(v)
    this.u8(v >>> 8)
  }
  u32(v) {
    this.u16(v & 0xffff)
    this.u16(v >>> 16)
  }
}

function encode(bands, numberSamples) {
  const contents = new Writer()
  bands.forEach((peaks, band) => {
    if (!peaks.length) return
    const p = new Writer()
    let last = 0
    for (const peak of peaks) {
      if (peak.fft - last >= 255) {
        p.u8(0xff)
        p.u32(peak.fft)
        last = peak.fft
      }
      p.u8(peak.fft - last)
      p.u16(peak.mag)
      p.u16(peak.bin)
      last = peak.fft
    }
    contents.u32(0x60030040 + band)
    contents.u32(p.bytes.length)
    contents.bytes.push(...p.bytes)
    while (contents.bytes.length % 4) contents.u8(0)
  })

  const w = new Writer()
  w.u32(0xcafe2580) // magic
  w.u32(0) // crc32, filled in below
  w.u32(contents.bytes.length + 8) // size minus header
  w.u32(0x94119c00) // magic
  w.u32(0)
  w.u32(0)
  w.u32(0)
  w.u32(3 << 27) // sample rate id 3 = 16000 Hz
  w.u32(0)
  w.u32(0)
  w.u32(Math.trunc(numberSamples + SAMPLE_RATE * 0.24))
  w.u32((15 << 19) + 0x40000)
  w.u32(0x40000000)
  w.u32(contents.bytes.length + 8)
  w.bytes.push(...contents.bytes)

  const bytes = Uint8Array.from(w.bytes)
  const crc = crc32(bytes, 8)
  bytes[4] = crc & 0xff
  bytes[5] = (crc >>> 8) & 0xff
  bytes[6] = (crc >>> 16) & 0xff
  bytes[7] = (crc >>> 24) & 0xff
  return bytes
}

// samples: Int16Array (or any array of numbers) — 16 kHz mono.
// Uses at most the first 12 s, like shazamio.
export function shazamSignature(samples) {
  const used = samples.length > SAMPLE_RATE * 12 ? samples.subarray(0, SAMPLE_RATE * 12) : samples
  const numberSamples = Math.floor(used.length / HOP) * HOP
  const bands = extractPeaks(used)
  return {
    uri: 'data:audio/vnd.shazam.sig;base64,' + base64(encode(bands, numberSamples)),
    samplems: Math.round((numberSamples / SAMPLE_RATE) * 1000),
    peaks: bands.reduce((s, b) => s + b.length, 0)
  }
}
