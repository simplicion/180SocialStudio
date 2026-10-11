/**
 * AudioWaveformService
 * 
 * High-performance client-side audio peak extraction and waveform generation,
 * adapted from FreeCut's Web Audio pipeline.
 * Extracts normalized peak amplitudes (0.0 - 1.0) and caches them in memory.
 */

class AudioWaveformService {
  private cache = new Map<string, Float32Array>();
  private pendingRequests = new Map<string, Promise<Float32Array>>();
  private audioCtx: AudioContext | null = null;

  private getAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    return this.audioCtx;
  }

  /**
   * Generates or extracts peaks for a given media URL.
   * Samples approximately 60 peaks per second of audio.
   */
  async getPeaks(url: string, durationSec: number = 10, sampleRate: number = 60): Promise<Float32Array> {
    if (!url) {
      return this.generateSyntheticPeaks(durationSec, sampleRate, "default");
    }

    const cacheKey = `${url}_${Math.round(durationSec)}_${sampleRate}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    if (this.pendingRequests.has(cacheKey)) {
      return this.pendingRequests.get(cacheKey)!;
    }

    const promise = (async () => {
      try {
        const ctx = this.getAudioContext();
        if (ctx && (url.startsWith("blob:") || url.startsWith("http:") || url.startsWith("https:") || url.startsWith("data:"))) {
          const res = await fetch(url);
          const arrayBuf = await res.arrayBuffer();
          const audioBuf = await ctx.decodeAudioData(arrayBuf);
          
          const channelData = audioBuf.getChannelData(0);
          const totalSamples = channelData.length;
          const targetPeakCount = Math.max(10, Math.floor(audioBuf.duration * sampleRate));
          const blockSize = Math.floor(totalSamples / targetPeakCount);
          const peaks = new Float32Array(targetPeakCount);

          for (let i = 0; i < targetPeakCount; i++) {
            let max = 0;
            const start = i * blockSize;
            const end = Math.min(start + blockSize, totalSamples);
            for (let j = start; j < end; j++) {
              const val = Math.abs(channelData[j]);
              if (val > max) max = val;
            }
            peaks[i] = Math.min(1.0, Math.max(0.04, max));
          }

          this.cache.set(cacheKey, peaks);
          return peaks;
        }
      } catch (err) {
        // Fallback to deterministic procedural peaks if decodeAudioData fails on remote CORS or local file scheme
        console.debug("Audio decode fallback triggered for:", url, err);
      }

      const synthetic = this.generateSyntheticPeaks(durationSec, sampleRate, url);
      this.cache.set(cacheKey, synthetic);
      return synthetic;
    })();

    this.pendingRequests.set(cacheKey, promise);
    try {
      const res = await promise;
      return res;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * Deterministic procedural soundwave generation based on file name seed.
   * Produces natural-looking speech/music soundwave envelopes with dynamic range.
   */
  generateSyntheticPeaks(durationSec: number, sampleRate: number = 60, seedKey: string = "180"): Float32Array {
    const totalPeaks = Math.max(10, Math.floor(durationSec * sampleRate));
    const peaks = new Float32Array(totalPeaks);
    
    // Hash the seed key to get pseudo-random seeds
    let hash = 0;
    for (let i = 0; i < seedKey.length; i++) {
      hash = (hash << 5) - hash + seedKey.charCodeAt(i);
      hash |= 0;
    }
    const seed = Math.abs(hash) || 42;

    for (let i = 0; i < totalPeaks; i++) {
      const t = i / sampleRate;
      // Multi-frequency harmonic envelope simulating voice syllables and pauses
      const syllable = Math.sin(t * 3.8 + (seed % 10)) * Math.cos(t * 1.7);
      const beat = Math.abs(Math.sin(t * 2.2 + (seed % 5)));
      const micro = Math.sin(t * 24.0) * 0.15;
      
      // Introduce periodic speech cadences & micro-pauses
      const pauseGate = Math.sin(t * 0.8 + (seed % 7)) > -0.2 ? 1.0 : 0.08;
      
      const rawAmp = (0.2 + 0.65 * beat + 0.25 * Math.abs(syllable) + micro) * pauseGate;
      peaks[i] = Math.max(0.06, Math.min(0.98, rawAmp));
    }

    return peaks;
  }
}

export const audioWaveformService = new AudioWaveformService();
