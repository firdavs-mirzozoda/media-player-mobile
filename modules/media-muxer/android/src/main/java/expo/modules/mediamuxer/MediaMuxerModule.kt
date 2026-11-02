package expo.modules.mediamuxer

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

class MediaMuxerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MediaMuxer")

    // Runs off the JS thread (AsyncFunction executes on the module's background queue).
    AsyncFunction("mux") { videoUri: String, audioUri: String, outUri: String ->
      mux(toPath(videoUri), toPath(audioUri), toPath(outUri))
      outUri
    }

    // Decodes an audio file (the mic recording) to 16 kHz mono signed 16-bit
    // PCM — the input Shazam's fingerprint needs. Returned as base64.
    AsyncFunction("decodePcm16k") { uri: String ->
      Base64.encodeToString(decodePcm16k(toPath(uri)), Base64.NO_WRAP)
    }

    // Seamless quality switching (like hls.js nextLevel): keeps ExoPlayer's
    // adaptive video selection away from every variant except the wanted
    // height by excluding the others for `durationMs`. Nothing is re-selected
    // or flushed — the next segment simply comes in the new quality.
    // JS re-applies this every ~2 s while a fixed quality is chosen (a new
    // track selection starts clean); height <= 0 ("auto") clears the exclusions.
    // Returns the height that was pinned, or 0 if no adaptive video selection.
    AsyncFunction("pinVideoHeight") { videoPlayer: expo.modules.video.player.VideoPlayer, height: Int, durationMs: Int ->
      pinVideoHeight(videoPlayer.player, height, durationMs.toLong())
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    // Repackages a file that already holds video + audio (e.g. concatenated
    // MPEG-TS segments from an HLS stream) into a regular mp4 — no re-encoding.
    AsyncFunction("remux") { inUri: String, outUri: String ->
      remux(toPath(inUri), toPath(outUri))
      outUri
    }

    // Grabs one frame of a video as a JPEG (for "find the film by a frame").
    // atMs < 0 means the middle of the video. Resolves with the JPEG's file URI.
    // `uri` may also be an http(s) link to a progressive mp4 — only the bytes
    // around that moment are fetched, not the whole video.
    AsyncFunction("frameAt") { uri: String, atMs: Double, outUri: String ->
      frameAt(if (uri.startsWith("http")) uri else toPath(uri), atMs.toLong(), toPath(outUri))
      outUri
    }
  }

  @androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
  private fun pinVideoHeight(exo: androidx.media3.exoplayer.ExoPlayer, height: Int, durationMs: Long): Int {
    val selections = exo.currentTrackSelections
    for (i in 0 until selections.length) {
      val sel = selections[i] as? androidx.media3.exoplayer.trackselection.ExoTrackSelection ?: continue
      if (sel.length() < 2) continue
      // the video selection: its formats have a picture size
      val sides = (0 until sel.length()).map {
        val f = sel.getFormat(it)
        if (f.width > 0 && f.height > 0) minOf(f.width, f.height) else -1
      }
      if (sides.any { it < 0 }) continue
      // drop earlier exclusions first: ExoPlayer refuses to exclude the last
      // allowed track, so a still-excluded target would block the switch
      clearExclusions(sel)
      if (height <= 0) return 0 // auto
      // the wanted height, else the closest one below it, else the smallest
      val target = sides.indices.filter { sides[it] <= height }.maxByOrNull { sides[it] }
        ?: sides.indices.minByOrNull { sides[it] }
        ?: continue
      for (j in sides.indices) if (j != target) sel.excludeTrack(j, durationMs)
      return sides[target]
    }
    return 0
  }

  // BaseTrackSelection keeps "excluded until" times in a private long[] with one
  // entry per track (0 = allowed). Found by type: R8 renames the field in release.
  private fun clearExclusions(sel: androidx.media3.exoplayer.trackselection.ExoTrackSelection) {
    var cls: Class<*>? = sel.javaClass
    while (cls != null) {
      for (field in cls.declaredFields) {
        if (field.type != LongArray::class.java) continue
        try {
          field.isAccessible = true
          val times = field.get(sel) as? LongArray ?: continue
          if (times.size == sel.length()) times.fill(0L)
        } catch (_: Exception) {
        }
      }
      cls = cls.superclass
    }
  }

  private fun isAdts(buf: ByteBuffer, pos: Int, end: Int): Boolean =
    pos + 7 <= end &&
      (buf.get(pos).toInt() and 0xFF) == 0xFF &&
      (buf.get(pos + 1).toInt() and 0xF6) == 0xF0

  // Android's MPEG-TS extractor hands out AAC audio as whole PES packets: a dozen or
  // more ADTS frames glued together, headers included. Written as one sample each,
  // players decode only the first frame of every packet — the video is nearly silent.
  // Split them into single frames without the ADTS header, each 1024 samples later.
  private fun writeAdtsFrames(
    muxer: MediaMuxer,
    track: Int,
    buf: ByteBuffer,
    size: Int,
    startUs: Long,
    sampleRate: Int,
    info: MediaCodec.BufferInfo
  ) {
    var pos = 0
    var frame = 0L
    while (isAdts(buf, pos, size)) {
      val b1 = buf.get(pos + 1).toInt() and 0xFF
      val b3 = buf.get(pos + 3).toInt() and 0xFF
      val b4 = buf.get(pos + 4).toInt() and 0xFF
      val b5 = buf.get(pos + 5).toInt() and 0xFF
      val frameLength = ((b3 and 0x03) shl 11) or (b4 shl 3) or (b5 shr 5)
      val headerLength = if (b1 and 0x01 == 1) 7 else 9 // protection_absent
      if (frameLength <= headerLength || pos + frameLength > size) break
      info.offset = pos + headerLength
      info.size = frameLength - headerLength
      info.presentationTimeUs = startUs + frame * 1024L * 1_000_000L / sampleRate
      info.flags = MediaCodec.BUFFER_FLAG_KEY_FRAME
      muxer.writeSampleData(track, buf, info)
      pos += frameLength
      frame++
    }
  }

  private fun remux(inPath: String, outPath: String) {
    File(outPath).delete()
    val extractor = MediaExtractor()
    var muxer: MediaMuxer? = null
    try {
      extractor.setDataSource(inPath)
      muxer = MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      val map = HashMap<Int, Int>()
      val aacRate = HashMap<Int, Int>() // AAC tracks -> sample rate
      for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith("video/") || mime.startsWith("audio/")) {
          extractor.selectTrack(i)
          map[i] = muxer.addTrack(format)
          if (mime == MediaFormat.MIMETYPE_AUDIO_AAC) aacRate[i] = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        }
      }
      if (map.isEmpty()) throw IllegalArgumentException("No audio/video tracks found")
      muxer.start()
      val buffer = ByteBuffer.allocate(4 * 1024 * 1024)
      val info = MediaCodec.BufferInfo()
      while (true) {
        val size = extractor.readSampleData(buffer, 0)
        if (size < 0) break
        val track = extractor.sampleTrackIndex
        val out = map[track]
        val rate = aacRate[track]
        if (out != null && rate != null && isAdts(buffer, 0, size)) {
          writeAdtsFrames(muxer, out, buffer, size, extractor.sampleTime, rate, info)
        } else if (out != null) {
          info.offset = 0
          info.size = size
          info.presentationTimeUs = extractor.sampleTime
          info.flags =
            if (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
          muxer.writeSampleData(out, buffer, info)
        }
        extractor.advance()
      }
      muxer.stop()
    } finally {
      extractor.release()
      try {
        muxer?.release()
      } catch (_: Exception) {
      }
    }
  }

  private fun frameAt(path: String, atMs: Long, outPath: String) {
    val retriever = android.media.MediaMetadataRetriever()
    try {
      if (path.startsWith("http")) {
        retriever.setDataSource(path, hashMapOf("User-Agent" to "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"))
      } else {
        retriever.setDataSource(path)
      }
      val durationMs =
        retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      val ms = if (atMs >= 0) atMs else durationMs / 2
      val frame = retriever.getFrameAtTime(ms * 1000, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        ?: throw IllegalStateException("Не удалось взять кадр из видео")
      // keep the upload small: longest side at most 1280 px
      val scale = minOf(1f, 1280f / maxOf(frame.width, frame.height))
      val bitmap =
        if (scale < 1f)
          android.graphics.Bitmap.createScaledBitmap(frame, (frame.width * scale).toInt(), (frame.height * scale).toInt(), true)
        else frame
      File(outPath).outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 88, it) }
    } finally {
      retriever.release()
    }
  }

  private fun decodePcm16k(path: String): ByteArray {
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      extractor.setDataSource(path)
      val track = selectTrack(extractor, "audio/")
      val format = extractor.getTrackFormat(track)
      var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
      codec.configure(format, null, null, 0)
      codec.start()

      val pcm = ByteArrayOutputStream()
      val info = MediaCodec.BufferInfo()
      var inputDone = false
      while (true) {
        if (!inputDone) {
          val i = codec.dequeueInputBuffer(10_000)
          if (i >= 0) {
            val n = extractor.readSampleData(codec.getInputBuffer(i)!!, 0)
            if (n < 0) {
              codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              codec.queueInputBuffer(i, 0, n, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        val o = codec.dequeueOutputBuffer(info, 10_000)
        if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          sampleRate = codec.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          channels = codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        } else if (o >= 0) {
          val buf = codec.getOutputBuffer(o)!!
          val chunk = ByteArray(info.size)
          buf.position(info.offset)
          buf.get(chunk)
          pcm.write(chunk)
          codec.releaseOutputBuffer(o, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
        }
      }

      // interleaved 16-bit -> mono floats
      val shorts = ByteBuffer.wrap(pcm.toByteArray()).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
      val frames = shorts.remaining() / channels
      val mono = FloatArray(frames)
      for (f in 0 until frames) {
        var sum = 0f
        for (c in 0 until channels) sum += shorts.get(f * channels + c)
        mono[f] = sum / channels
      }

      // resample to 16 kHz (linear; the recorder already records at 16 kHz,
      // so normally this is a straight copy)
      val outFrames = (frames.toLong() * 16000 / sampleRate).toInt()
      val out = ByteBuffer.allocate(outFrames * 2).order(ByteOrder.LITTLE_ENDIAN)
      for (i in 0 until outFrames) {
        val pos = i.toDouble() * sampleRate / 16000
        val i0 = pos.toInt().coerceAtMost(frames - 1)
        val i1 = (i0 + 1).coerceAtMost(frames - 1)
        val frac = (pos - i0).toFloat()
        val v = mono[i0] * (1 - frac) + mono[i1] * frac
        out.putShort(v.coerceIn(-32768f, 32767f).toInt().toShort())
      }
      return out.array()
    } finally {
      try {
        codec?.stop()
      } catch (_: Exception) {
      }
      codec?.release()
      extractor.release()
    }
  }

  private fun toPath(uri: String): String = Uri.parse(uri).path ?: uri

  private fun selectTrack(extractor: MediaExtractor, mimePrefix: String): Int {
    for (i in 0 until extractor.trackCount) {
      val mime = extractor.getTrackFormat(i).getString(android.media.MediaFormat.KEY_MIME) ?: continue
      if (mime.startsWith(mimePrefix)) {
        extractor.selectTrack(i)
        return i
      }
    }
    throw IllegalArgumentException("No $mimePrefix track found")
  }

  private fun copyTrack(extractor: MediaExtractor, muxer: MediaMuxer, track: Int) {
    val buffer = ByteBuffer.allocate(4 * 1024 * 1024)
    val info = MediaCodec.BufferInfo()
    while (true) {
      val size = extractor.readSampleData(buffer, 0)
      if (size < 0) break
      info.offset = 0
      info.size = size
      info.presentationTimeUs = extractor.sampleTime
      info.flags =
        if (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
      muxer.writeSampleData(track, buffer, info)
      extractor.advance()
    }
  }

  private fun mux(videoPath: String, audioPath: String, outPath: String) {
    File(outPath).delete()
    val video = MediaExtractor()
    val audio = MediaExtractor()
    var muxer: MediaMuxer? = null
    try {
      video.setDataSource(videoPath)
      audio.setDataSource(audioPath)
      val videoIn = selectTrack(video, "video/")
      val audioIn = selectTrack(audio, "audio/")
      muxer = MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      val videoOut = muxer.addTrack(video.getTrackFormat(videoIn))
      val audioOut = muxer.addTrack(audio.getTrackFormat(audioIn))
      muxer.start()
      copyTrack(video, muxer, videoOut)
      copyTrack(audio, muxer, audioOut)
      muxer.stop()
    } finally {
      video.release()
      audio.release()
      try {
        muxer?.release()
      } catch (_: Exception) {
      }
    }
  }
}
