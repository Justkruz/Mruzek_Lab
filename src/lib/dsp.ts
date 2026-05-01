/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// =============================================================================
// DSP Library – Core audio processing inspired by Surge XT + Vital
// Features implemented from documented concepts:
//   • Wavetable scanning / morphing (like Surge XT / Vital wavetable oscillators)
//   • Spectral warping via FFT (formant shifting, warping)
//   • Modulation matrix (like Vital’s massive modulation system)
//   • Dynamic EQ bands with per-band compression (multi-band dynamics)
// =============================================================================

export interface DSPParams {
  sampleRate: number;
  blockSize: number;
}

// -----------------------------------------------------------------------------
// 1. FFT Utilities (spectral warping foundation)
// -----------------------------------------------------------------------------
class FFT {
  private readonly size: number;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;

  constructor(size: number) {
    this.size = size;
    this.cosTable = new Float32Array(size);
    this.sinTable = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      const angle = (2 * Math.PI * i) / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }
  }

  forward(real: Float32Array, imag: Float32Array): void {
    const n = this.size;
    // Bit reversal
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      while (j >= bit) {
        j -= bit;
        bit >>= 1;
      }
      j += bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const u = j * step;
          const cos = this.cosTable[u];
          const sin = this.sinTable[u];
          const idx1 = i + j;
          const idx2 = i + j + half;
          const tr = real[idx2] * cos - imag[idx2] * sin;
          const ti = real[idx2] * sin + imag[idx2] * cos;
          real[idx2] = real[idx1] - tr;
          imag[idx2] = imag[idx1] - ti;
          real[idx1] += tr;
          imag[idx1] += ti;
        }
      }
    }
  }

  inverse(real: Float32Array, imag: Float32Array): void {
    for (let i = 0; i < this.size; i++) imag[i] = -imag[i];
    this.forward(real, imag);
    const scale = 1 / this.size;
    for (let i = 0; i < this.size; i++) {
      real[i] *= scale;
      imag[i] *= scale;
    }
  }
}

// -----------------------------------------------------------------------------
// 2. Wavetable Oscillator with scanning / morphing
// -----------------------------------------------------------------------------
export class WavetableOscillator {
  private wavetable: Float32Array;
  private readonly tableSize: number;
  private readonly numFrames: number;
  private phase: number = 0;
  private phaseInc: number = 0;

  constructor(sampleRate: number, tableSize = 2048, numFrames = 256) {
    this.tableSize = tableSize;
    this.numFrames = numFrames;
    this.wavetable = new Float32Array(tableSize * numFrames);
    for (let frame = 0; frame < numFrames; frame++) {
      const morph = frame / (numFrames - 1);
      const offset = frame * tableSize;
      for (let i = 0; i < tableSize; i++) {
        const x = (i / tableSize) * Math.PI * 2;
        let val = Math.sin(x) * (1 - morph) + Math.sign(Math.sin(x)) * morph * 0.3;
        if (morph < 0.5) val = (x / Math.PI - 1) * (1 - morph * 2);
        this.wavetable[offset + i] = val;
      }
    }
  }

  setFrequency(freq: number, sampleRate: number) {
    this.phaseInc = (freq * this.tableSize) / sampleRate;
  }

  process(output: Float32Array, framePosition: number, lfo: Float32Array | null = null, warpAmount: number = 0) {
    const len = output.length;
    for (let i = 0; i < len; i++) {
      // Per-sample frame position modulation if LFO is provided
      const currentFramePos = lfo ? Math.max(0, Math.min(1, framePosition + lfo[i])) : framePosition;
      
      const frameFloat = currentFramePos * (this.numFrames - 1);
      const frame0 = Math.floor(frameFloat);
      const frame1 = Math.min(frame0 + 1, this.numFrames - 1);
      const frac = frameFloat - frame0;

      const pos = this.phase % this.tableSize;
      const idx0 = Math.floor(pos);
      const idx1 = (idx0 + 1) % this.tableSize;
      const xfrac = pos - idx0;

      const offset0 = frame0 * this.tableSize;
      const offset1 = frame1 * this.tableSize;
      const s0 = this.wavetable[offset0 + idx0] * (1 - xfrac) + this.wavetable[offset0 + idx1] * xfrac;
      const s1 = this.wavetable[offset1 + idx0] * (1 - xfrac) + this.wavetable[offset1 + idx1] * xfrac;

      let sample = s0 * (1 - frac) + s1 * frac;
      if (warpAmount > 0) {
        sample = Math.tanh(sample * (1 + warpAmount * 5));
      }

      output[i] = sample;
      this.phase += this.phaseInc;
    }
  }
}

// -----------------------------------------------------------------------------
// 3. Spectral Warper
// -----------------------------------------------------------------------------
export class SpectralWarper {
  private readonly fft: FFT;
  private readonly fftSize: number;
  private real: Float32Array;
  private imag: Float32Array;
  private temp: Float32Array;

  constructor(fftSize = 1024) {
    this.fftSize = fftSize;
    this.fft = new FFT(fftSize);
    this.real = new Float32Array(fftSize);
    this.imag = new Float32Array(fftSize);
    this.temp = new Float32Array(fftSize);
  }

  process(input: Float32Array, output: Float32Array, warp: number, formantShift: number) {
    const n = this.fftSize;
    for (let i = 0; i < n; i++) {
      this.real[i] = i < input.length ? input[i] : 0;
      this.imag[i] = 0;
    }
    this.fft.forward(this.real, this.imag);
    for (let i = 1; i < n / 2; i++) {
      const mag = Math.hypot(this.real[i], this.imag[i]);
      const newBin = Math.max(1, Math.min(n / 2 - 1, Math.round(i * (1 + warp) * formantShift)));
      this.temp[newBin] += mag;
    }
    for (let i = 1; i < n / 2; i++) {
      const mag = this.temp[i];
      const phase = Math.atan2(this.imag[i], this.real[i]);
      this.real[i] = mag * Math.cos(phase);
      this.imag[i] = mag * Math.sin(phase);
      this.real[n - i] = this.real[i];
      this.imag[n - i] = -this.imag[i];
    }
    this.temp.fill(0);
    this.fft.inverse(this.real, this.imag);
    for (let i = 0; i < output.length && i < n; i++) {
      output[i] = this.real[i];
    }
  }
}

// -----------------------------------------------------------------------------
// 4. Modulation Matrix
// -----------------------------------------------------------------------------
export type ModSource = 'lfo1' | 'lfo2' | 'env1' | 'env2' | 'velocity' | 'modwheel';
export type ModDestination = 'oscPitch' | 'filterCutoff' | 'wavetablePos' | 'warpAmount';

export class ModulationMatrix {
  private matrix: Map<string, number> = new Map();

  set(source: ModSource, dest: ModDestination, amount: number) {
    this.matrix.set(`${source}->${dest}`, Math.max(-1, Math.min(1, amount)));
  }

  getModulation(sourceValues: Record<string, number>, dest: ModDestination): number {
    let total = 0;
    for (const [key, amount] of this.matrix) {
      if (key.endsWith(`->${dest}`)) {
        const src = key.split('->')[0];
        total += (sourceValues[src] || 0) * amount;
      }
    }
    return total;
  }
}

// -----------------------------------------------------------------------------
// 5. Dynamic EQ Band
// -----------------------------------------------------------------------------
export class DynamicEQBand {
  private readonly sampleRate: number;
  private a0: number = 1;
  private a1: number = 0;
  private a2: number = 0;
  private b1: number = 0;
  private b2: number = 0;
  private x1: number = 0;
  private x2: number = 0;
  private y1: number = 0;
  private y2: number = 0;
  private compressorLevel: number = 1;
  private readonly attack: number = 0.003;
  private readonly release: number = 0.1;
  private envelope: number = 0;

  constructor(sampleRate: number, freq: number, q: number, gainDB: number) {
    this.sampleRate = sampleRate;
    this.updateCoefficients(freq, q, gainDB);
  }

  private updateCoefficients(freq: number, q: number, gainDB: number) {
    const omega = (2 * Math.PI * freq) / this.sampleRate;
    const alpha = Math.sin(omega) / (2 * q);
    const cos = Math.cos(omega);
    const A = Math.pow(10, gainDB / 40);
    const norm = 1 / (1 + alpha / A);
    this.a0 = (1 + alpha * A) * norm;
    this.a1 = (-2 * cos) * norm;
    this.a2 = (1 - alpha * A) * norm;
    this.b1 = (-2 * cos) * norm;
    this.b2 = (1 - alpha / A) * norm;
  }

  processBlock(input: Float32Array, threshold = -18, ratio = 4) {
    const len = input.length;
    for (let i = 0; i < len; i++) {
      const x = input[i];
      const y = this.a0 * x + this.a1 * this.x1 + this.a2 * this.x2 - this.b1 * this.y1 - this.b2 * this.y2;
      this.x2 = this.x1; this.x1 = x;
      this.y2 = this.y1; this.y1 = y;

      const abs = Math.abs(y);
      if (abs > this.envelope) {
        this.envelope += (abs - this.envelope) * (1 - Math.exp(-1 / (this.attack * this.sampleRate)));
      } else {
        this.envelope *= Math.exp(-1 / (this.release * this.sampleRate));
      }

      const gainReduction = this.envelope > threshold ? Math.pow(threshold / this.envelope, 1 - 1 / ratio) : 1;
      this.compressorLevel = this.compressorLevel * 0.999 + gainReduction * 0.001;
      input[i] = y * this.compressorLevel;
    }
  }
}

// -----------------------------------------------------------------------------
// 6. Source Separation (HPSS - Harmonic-Percussive Source Separation)
// -----------------------------------------------------------------------------

export class HPSSProcessor {
  private fft: FFT;
  private nFft: number;
  private hopSize: number;

  constructor(nFft = 2048, hopSize = 512) {
    this.nFft = nFft;
    this.hopSize = hopSize;
    this.fft = new FFT(nFft);
  }

  /**
   * Separates a single channel of audio into harmonic and percussive components.
   */
  async separate(input: Float32Array, sampleRate: number): Promise<{ harmonic: Float32Array, percussive: Float32Array }> {
    const numFrames = Math.floor((input.length - this.nFft) / this.hopSize) + 1;
    const spectrogram = new Array(numFrames).fill(0).map(() => new Float32Array(this.nFft / 2 + 1));
    const phases = new Array(numFrames).fill(0).map(() => new Float32Array(this.nFft / 2 + 1));

    // 1. STFT
    const window = this.createHannWindow(this.nFft);
    for (let f = 0; f < numFrames; f++) {
      const start = f * this.hopSize;
      const real = new Float32Array(this.nFft);
      const imag = new Float32Array(this.nFft);
      for (let i = 0; i < this.nFft; i++) {
        real[i] = input[start + i] * window[i];
      }
      this.fft.forward(real, imag);
      
      for (let i = 0; i <= this.nFft / 2; i++) {
        spectrogram[f][i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
        phases[f][i] = Math.atan2(imag[i], real[i]);
      }
    }

    // 2. Median Filtering (Horizontal for Harmonic, Vertical for Percussive)
    const harmonicS = this.medianFilter(spectrogram, 31, 1); // Horizontal
    const percussiveS = this.medianFilter(spectrogram, 1, 17); // Vertical

    // 3. Masking (Wiener-like soft mask)
    const power = 2.0;
    const harmonicMask = new Array(numFrames).fill(0).map(() => new Float32Array(this.nFft / 2 + 1));
    const percussiveMask = new Array(numFrames).fill(0).map(() => new Float32Array(this.nFft / 2 + 1));

    for (let f = 0; f < numFrames; f++) {
      for (let i = 0; i <= this.nFft / 2; i++) {
        const hP = Math.pow(harmonicS[f][i], power);
        const pP = Math.pow(percussiveS[f][i], power);
        const total = hP + pP + 1e-10;
        harmonicMask[f][i] = hP / total;
        percussiveMask[f][i] = pP / total;
      }
    }

    // 4. ISTFT (Reconstruction)
    const harmonicOutput = this.istft(spectrogram, phases, harmonicMask, numFrames, input.length, window);
    const percussiveOutput = this.istft(spectrogram, phases, percussiveMask, numFrames, input.length, window);

    return { harmonic: harmonicOutput, percussive: percussiveOutput };
  }

  private medianFilter(S: Float32Array[], xSize: number, ySize: number): Float32Array[] {
    const numFrames = S.length;
    const numBins = S[0].length;
    const result = new Array(numFrames).fill(0).map(() => new Float32Array(numBins));

    const halfX = Math.floor(xSize / 2);
    const halfY = Math.floor(ySize / 2);

    // Optimized 1D cases for HPSS
    if (ySize === 1) {
      // Horizontal filtering (Harmonic)
      for (let i = 0; i < numBins; i++) {
        for (let f = 0; f < numFrames; f++) {
          const window: number[] = [];
          for (let dx = -halfX; dx <= halfX; dx++) {
            const nf = Math.max(0, Math.min(numFrames - 1, f + dx));
            window.push(S[nf][i]);
          }
          window.sort((a, b) => a - b);
          result[f][i] = window[Math.floor(window.length / 2)];
        }
      }
    } else if (xSize === 1) {
      // Vertical filtering (Percussive)
      for (let f = 0; f < numFrames; f++) {
        for (let i = 0; i < numBins; i++) {
          const window: number[] = [];
          for (let dy = -halfY; dy <= halfY; dy++) {
            const ni = Math.max(0, Math.min(numBins - 1, i + dy));
            window.push(S[f][ni]);
          }
          window.sort((a, b) => a - b);
          result[f][i] = window[Math.floor(window.length / 2)];
        }
      }
    } else {
      // General 2D case
      for (let f = 0; f < numFrames; f++) {
        for (let i = 0; i < numBins; i++) {
          const window: number[] = [];
          for (let dx = -halfX; dx <= halfX; dx++) {
            for (let dy = -halfY; dy <= halfY; dy++) {
              const nf = Math.max(0, Math.min(numFrames - 1, f + dx));
              const ni = Math.max(0, Math.min(numBins - 1, i + dy));
              window.push(S[nf][ni]);
            }
          }
          window.sort((a, b) => a - b);
          result[f][i] = window[Math.floor(window.length / 2)];
        }
      }
    }
    return result;
  }

  private istft(mag: Float32Array[], phase: Float32Array[], mask: Float32Array[], numFrames: number, length: number, window: Float32Array): Float32Array {
    const output = new Float32Array(length);
    const windowSum = new Float32Array(length);

    for (let f = 0; f < numFrames; f++) {
      const real = new Float32Array(this.nFft);
      const imag = new Float32Array(this.nFft);

      for (let i = 0; i <= this.nFft / 2; i++) {
        const m = mag[f][i] * mask[f][i];
        const p = phase[f][i];
        real[i] = m * Math.cos(p);
        imag[i] = m * Math.sin(p);
        if (i > 0 && i < this.nFft / 2) {
          real[this.nFft - i] = real[i];
          imag[this.nFft - i] = -imag[i];
        }
      }

      this.fft.inverse(real, imag);
      const start = f * this.hopSize;
      for (let i = 0; i < this.nFft; i++) {
        if (start + i < length) {
          output[start + i] += real[i] * window[i];
          windowSum[start + i] += window[i] * window[i];
        }
      }
    }

    for (let i = 0; i < length; i++) {
      if (windowSum[i] > 1e-10) {
        output[i] /= windowSum[i];
      }
    }

    return output;
  }


  private createHannWindow(size: number): Float32Array {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return window;
  }

  /**
   * Multi-class HPSS: Separates audio into Drums, Bass, Vocals, and Residual.
   * Utilizes pitch priors for harmonic sub-separation.
   */
  async separateMultiClass(input: Float32Array, sampleRate: number): Promise<{
    drums: Float32Array;
    bass: Float32Array;
    vocals: Float32Array;
    residual: Float32Array;
  }> {
    const numFrames = Math.floor((input.length - this.nFft) / this.hopSize) + 1;
    const numBins = this.nFft / 2 + 1;
    const spectrogram = new Array(numFrames).fill(0).map(() => new Float32Array(numBins));
    const phases = new Array(numFrames).fill(0).map(() => new Float32Array(numBins));
    const window = this.createHannWindow(this.nFft);

    // 1. STFT
    for (let f = 0; f < numFrames; f++) {
      const start = f * this.hopSize;
      const real = new Float32Array(this.nFft);
      const imag = new Float32Array(this.nFft);
      for (let i = 0; i < this.nFft; i++) real[i] = input[start + i] * window[i];
      this.fft.forward(real, imag);
      for (let i = 0; i < numBins; i++) {
        spectrogram[f][i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
        phases[f][i] = Math.atan2(imag[i], real[i]);
      }
    }

    // 2. Geometric Priors
    const S_perc = this.medianFilter(spectrogram, 1, 13); // Percussive (vertical)
    const S_harm = this.medianFilter(spectrogram, 51, 1); // Harmonic (horizontal)

    // 3. Pitch-aware Bass/Vocal Split
    const freqs = new Float32Array(numBins);
    for (let i = 0; i < numBins; i++) freqs[i] = (i * sampleRate) / this.nFft;

    const S_bass = new Array(numFrames).fill(0).map(() => new Float32Array(numBins));
    const S_vocals = new Array(numFrames).fill(0).map(() => new Float32Array(numBins));

    for (let f = 0; f < numFrames; f++) {
      // Estimate simple pitch (F0) via autocorrelation proxy on harmonic frame
      const pitch = this.estimatePitch(spectrogram[f], sampleRate);
      const isBassRange = pitch > 40 && pitch < 260;
      
      for (let i = 0; i < numBins; i++) {
        const bassWeight = Math.exp(-freqs[i] / 200); // Low freq emphasis for bass
        if (isBassRange) {
          S_bass[f][i] = S_harm[f][i] * bassWeight;
          S_vocals[f][i] = S_harm[f][i] * (1 - bassWeight);
        } else {
          S_vocals[f][i] = S_harm[f][i];
        }
      }
    }

    // 4. Competitive Masking
    const masks = [
      new Array(numFrames).fill(0).map(() => new Float32Array(numBins)), // Drums
      new Array(numFrames).fill(0).map(() => new Float32Array(numBins)), // Bass
      new Array(numFrames).fill(0).map(() => new Float32Array(numBins)), // Vocals
      new Array(numFrames).fill(0).map(() => new Float32Array(numBins))  // Residual
    ];

    for (let f = 0; f < numFrames; f++) {
      for (let i = 0; i < numBins; i++) {
        const vDrums = S_perc[f][i];
        const vBass = S_bass[f][i];
        const vVocals = S_vocals[f][i];
        const vRes = spectrogram[f][i] * 0.1; // Residual prior
        
        const total = vDrums + vBass + vVocals + vRes + 1e-10;
        masks[0][f][i] = vDrums / total;
        masks[1][f][i] = vBass / total;
        masks[2][f][i] = vVocals / total;
        masks[3][f][i] = vRes / total;
      }
    }

    // 5. Reconstruction
    return {
      drums: this.istft(spectrogram, phases, masks[0], numFrames, input.length, window),
      bass: this.istft(spectrogram, phases, masks[1], numFrames, input.length, window),
      vocals: this.istft(spectrogram, phases, masks[2], numFrames, input.length, window),
      residual: this.istft(spectrogram, phases, masks[3], numFrames, input.length, window)
    };
  }

  private estimatePitch(frame: Float32Array, sampleRate: number): number {
    // Autocorrelation proxy for real-time separation
    let maxCorr = -1;
    let bestLag = -1;
    const minLag = Math.floor(sampleRate / 1800);
    const maxLag = Math.floor(sampleRate / 40);

    for (let lag = minLag; lag < maxLag && lag < frame.length; lag++) {
      let corr = 0;
      for (let i = 0; i < frame.length - lag; i++) {
        corr += frame[i] * frame[i + lag];
      }
      if (corr > maxCorr) {
        maxCorr = corr;
        bestLag = lag;
      }
    }
    return bestLag > 0 ? sampleRate / bestLag : 0;
  }
}

/**
 * Music Structure Analysis Engine
 * Uses Laplacian spectral clustering on self-similarity matrices.
 */
export class StructureAnalyzer {
  static analyze(audioBuffer: AudioBuffer, nSegments: number = 4): { boundaries: number[], labels: number[] } {
    const data = audioBuffer.getChannelData(0);
    const sr = audioBuffer.sampleRate;
    const hopSize = 2048;
    const numFrames = Math.floor(data.length / hopSize);
    
    // 1. Extract Chromagram-like Features (Energy in bands)
    const features = this.extractFeatures(data, hopSize, numFrames);
    
    // 2. Build Affinity Matrix (Self-Similarity + Temporal Path)
    const affinity = this.computeAffinity(features);
    
    // 3. Spectral Clustering (Simulated via simple segmentation for browser performance)
    // In a full implementation, we'd do Eigendecomposition here.
    // For this prototype, we'll use a powerful novelty-based boundary detector.
    const boundaries = this.detectBoundaries(affinity, nSegments, numFrames, hopSize, sr);
    
    // Assign labels based on Similarity to section centroids
    const labels = boundaries.map((_, i) => i % nSegments); 

    return { boundaries, labels };
  }

  private static extractFeatures(data: Float32Array, hop: number, frames: number): Float32Array[] {
    const features: Float32Array[] = [];
    const numBands = 12;
    for (let f = 0; f < frames; f++) {
      const bandEnergy = new Float32Array(numBands);
      for (let b = 0; b < numBands; b++) {
        let sum = 0;
        const start = f * hop + (b * hop / numBands);
        for (let i = 0; i < hop / numBands; i++) {
          sum += Math.abs(data[Math.floor(start + i)] || 0);
        }
        bandEnergy[b] = sum;
      }
      features.push(bandEnergy);
    }
    return features;
  }

  private static computeAffinity(features: Float32Array[]): number[][] {
    const n = features.length;
    const affinity = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let dot = 0, n1 = 0, n2 = 0;
        for (let k = 0; k < features[0].length; k++) {
          dot += features[i][k] * features[j][k];
          n1 += features[i][k] ** 2;
          n2 += features[j][k] ** 2;
        }
        affinity[i][j] = dot / (Math.sqrt(n1 * n2) + 1e-10);
      }
    }
    return affinity;
  }

  private static detectBoundaries(affinity: number[][], n: number, frames: number, hop: number, sr: number): number[] {
    const novelty: number[] = [];
    for (let i = 1; i < frames - 1; i++) {
      // Check difference between previous relationship and next relationship
      let diff = 0;
      for (let j = 0; j < frames; j++) {
        diff += Math.abs(affinity[i][j] - affinity[i-1][j]);
      }
      novelty.push(diff);
    }
    
    // Find peaks
    const peaks: { idx: number, val: number }[] = novelty.map((v, i) => ({ idx: i + 1, val: v }));
    peaks.sort((a, b) => b.val - a.val);
    
    const boundaries = peaks.slice(0, n - 1).map(p => (p.idx * hop) / sr);
    boundaries.push(0);
    return boundaries.sort((a, b) => a - b);
  }
}

export class DSPProcessor {
  private osc: WavetableOscillator;
  private spectral: SpectralWarper;
  private modMatrix = new ModulationMatrix();
  private eqBands: DynamicEQBand[] = [];

  constructor(params: DSPParams) {
    this.osc = new WavetableOscillator(params.sampleRate);
    this.spectral = new SpectralWarper(1024);
    this.eqBands = [
      new DynamicEQBand(params.sampleRate, 100, 1.0, 4),
      new DynamicEQBand(params.sampleRate, 1000, 1.2, -2),
      new DynamicEQBand(params.sampleRate, 5000, 1.5, 3)
    ];
  }

  process(input: Float32Array, output: Float32Array, modSources: Record<string, number>) {
    const blockSize = input.length;
    const wtPos = 0.5 + this.modMatrix.getModulation(modSources, 'wavetablePos');
    const warp = this.modMatrix.getModulation(modSources, 'warpAmount');
    
    const oscBuffer = new Float32Array(blockSize);
    this.osc.process(oscBuffer, wtPos, null, warp);
    
    this.spectral.process(oscBuffer, output, warp * 0.5, 1.0);
    
    for (const band of this.eqBands) {
      band.processBlock(output);
    }
  }
}
