import type { AudioFeatures } from '../types';

/**
 * Calculate RMS (Root Mean Square) volume from audio data
 */
export function calculateRMS(dataArray: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i] * dataArray[i];
  }
  return Math.sqrt(sum / dataArray.length);
}

/**
 * Calculate Zero Crossing Rate - useful for voice detection
 */
export function calculateZeroCrossingRate(dataArray: ArrayLike<number>): number {
  let crossings = 0;
  for (let i = 1; i < dataArray.length; i++) {
    if ((dataArray[i] >= 0 && dataArray[i - 1] < 0) || 
        (dataArray[i] < 0 && dataArray[i - 1] >= 0)) {
      crossings++;
    }
  }
  return crossings / dataArray.length;
}

/**
 * Calculate Spectral Centroid - the "center of mass" of the spectrum
 * Higher values indicate brighter sounds
 */
export function calculateSpectralCentroid(
  frequencyData: ArrayLike<number>,
  sampleRate: number,
  fftSize: number
): number {
  let weightedSum = 0;
  let sum = 0;
  const binFrequency = sampleRate / fftSize;

  for (let i = 0; i < frequencyData.length; i++) {
    const magnitude = frequencyData[i];
    const frequency = i * binFrequency;
    weightedSum += magnitude * frequency;
    sum += magnitude;
  }

  return sum > 0 ? weightedSum / sum : 0;
}

/**
 * Estimate fundamental frequency (pitch) using improved autocorrelation
 * with normalization and harmonic rejection
 */
export function estimatePitch(dataArray: ArrayLike<number>, sampleRate: number): number {
  const minPeriod = Math.floor(sampleRate / 500); // Max 500 Hz
  const maxPeriod = Math.floor(sampleRate / 50);  // Min 50 Hz
  
  // Normalize the signal to improve autocorrelation accuracy
  const normalized = new Float32Array(dataArray.length);
  let max = 0;
  for (let i = 0; i < dataArray.length; i++) {
    max = Math.max(max, Math.abs(dataArray[i]));
  }
  const scale = max > 0 ? 1 / max : 1;
  for (let i = 0; i < dataArray.length; i++) {
    normalized[i] = dataArray[i] * scale;
  }
  
  let bestCorrelation = 0;
  let bestPeriod = 0;
  let secondBestCorrelation = 0;
  let secondBestPeriod = 0;

  for (let period = minPeriod; period < maxPeriod && period < normalized.length / 2; period++) {
    let correlation = 0;
    let norm = 0;
    
    for (let i = 0; i < normalized.length - period; i++) {
      correlation += normalized[i] * normalized[i + period];
      norm += normalized[i] * normalized[i];
    }
    
    // Normalized correlation (prevents amplitude bias)
    const normalizedCorr = norm > 0 ? correlation / norm : 0;
    
    if (normalizedCorr > bestCorrelation) {
      secondBestCorrelation = bestCorrelation;
      secondBestPeriod = bestPeriod;
      bestCorrelation = normalizedCorr;
      bestPeriod = period;
    } else if (normalizedCorr > secondBestCorrelation) {
      secondBestCorrelation = normalizedCorr;
      secondBestPeriod = period;
    }
  }

  // Require clear peak to avoid harmonics (best must be significantly better than second)
  if (bestCorrelation > 0.3 && bestCorrelation > secondBestCorrelation * 1.2) {
    return bestPeriod > 0 ? sampleRate / bestPeriod : 0;
  }
  
  return 0; // Invalid pitch - no clear fundamental frequency
}

/**
 * Find peak frequency in a given range
 */
function findPeakInRange(
  data: ArrayLike<number>,
  startBin: number,
  endBin: number,
  binWidth: number
): number {
  let maxVal = 0;
  let maxBin = startBin;
  
  for (let i = startBin; i < endBin && i < data.length; i++) {
    if (data[i] > maxVal) {
      maxVal = data[i];
      maxBin = i;
    }
  }
  
  return maxBin * binWidth; // Return frequency in Hz
}

/**
 * Extract formant frequencies (F1, F2, F3) - very speaker-specific
 * Formants are resonant frequencies of the vocal tract
 */
export function extractFormants(
  frequencyData: ArrayLike<number>,
  sampleRate: number,
  fftSize: number
): { f1: number; f2: number; f3: number } {
  const binWidth = sampleRate / fftSize;
  
  // Typical formant ranges for human speech
  // F1: 300-800 Hz (vowel height, mouth opening)
  // F2: 800-2500 Hz (vowel frontness, tongue position)
  // F3: 2500-3500 Hz (additional speaker characteristic, nasal quality)
  
  const f1Start = Math.floor(300 / binWidth);
  const f1End = Math.floor(800 / binWidth);
  const f2Start = Math.floor(800 / binWidth);
  const f2End = Math.floor(2500 / binWidth);
  const f3Start = Math.floor(2500 / binWidth);
  const f3End = Math.floor(3500 / binWidth);
  
  const f1 = findPeakInRange(frequencyData, f1Start, f1End, binWidth);
  const f2 = findPeakInRange(frequencyData, f2Start, f2End, binWidth);
  const f3 = findPeakInRange(frequencyData, f3Start, f3End, binWidth);
  
  return { f1, f2, f3 };
}

/**
 * Calculate simplified MFCC-like features
 * These are mel-frequency band energies (not full MFCC but computationally lighter)
 */
export function calculateMelBandEnergies(
  frequencyData: ArrayLike<number>,
  sampleRate: number,
  numBands: number = 13
): number[] {
  const bands: number[] = new Array(numBands).fill(0);
  const maxFreq = sampleRate / 2;
  const binWidth = maxFreq / frequencyData.length;

  // Mel scale conversion helpers
  const freqToMel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const melToFreq = (m: number) => 700 * (Math.pow(10, m / 2595) - 1);

  const minMel = freqToMel(20);
  const maxMel = freqToMel(maxFreq);
  const melStep = (maxMel - minMel) / (numBands + 1);

  for (let band = 0; band < numBands; band++) {
    const melStart = minMel + band * melStep;
    const melCenter = minMel + (band + 1) * melStep;
    const melEnd = minMel + (band + 2) * melStep;

    const freqStart = melToFreq(melStart);
    const freqCenter = melToFreq(melCenter);
    const freqEnd = melToFreq(melEnd);

    const binStart = Math.floor(freqStart / binWidth);
    const binCenter = Math.floor(freqCenter / binWidth);
    const binEnd = Math.min(Math.floor(freqEnd / binWidth), frequencyData.length - 1);

    let energy = 0;
    for (let bin = binStart; bin <= binEnd; bin++) {
      // Triangular filter
      let weight = 0;
      if (bin < binCenter) {
        weight = (bin - binStart) / (binCenter - binStart + 1);
      } else {
        weight = (binEnd - bin) / (binEnd - binCenter + 1);
      }
      energy += frequencyData[bin] * weight;
    }
    bands[band] = energy;
  }

  // Normalize
  const maxEnergy = Math.max(...bands, 1);
  return bands.map(e => e / maxEnergy);
}

/**
 * Extract all audio features from analyzer nodes
 */
export function extractAudioFeatures(
  analyser: AnalyserNode,
  timeDomainData: Float32Array<ArrayBuffer>,
  frequencyData: Uint8Array<ArrayBuffer>,
  sampleRate: number
): AudioFeatures {
  analyser.getFloatTimeDomainData(timeDomainData);
  analyser.getByteFrequencyData(frequencyData);

  const volume = calculateRMS(timeDomainData);
  const pitch = estimatePitch(timeDomainData, sampleRate);
  const spectralCentroid = calculateSpectralCentroid(frequencyData, sampleRate, analyser.fftSize);
  const zeroCrossingRate = calculateZeroCrossingRate(timeDomainData);
  const formants = extractFormants(frequencyData, sampleRate, analyser.fftSize);
  const mfcc = calculateMelBandEnergies(frequencyData, sampleRate, 13); // Use 13 MFCC coefficients

  // Create copies for visualization
  const waveformData = new Uint8Array(timeDomainData.length);
  for (let i = 0; i < timeDomainData.length; i++) {
    waveformData[i] = Math.floor((timeDomainData[i] + 1) * 128);
  }

  return {
    volume,
    pitch,
    spectralCentroid,
    zeroCrossingRate,
    mfcc,
    formants,
    frequencyData: new Uint8Array(frequencyData),
    waveformData,
  };
}

/**
 * Noise floor estimation for adaptive thresholding
 */
interface NoiseFloor {
  volume: number;
  spectralCentroid: number;
  samples: number;
}

let noiseFloor: NoiseFloor = {
  volume: 0,
  spectralCentroid: 0,
  samples: 0,
};

const NOISE_ESTIMATION_SAMPLES = 30; // First 30 frames estimate noise
const NOISE_MULTIPLIER = 2.5; // Noise threshold = noise floor * this

/**
 * Update noise floor estimation during quiet periods
 */
export function updateNoiseFloor(features: AudioFeatures): void {
  if (noiseFloor.samples < NOISE_ESTIMATION_SAMPLES) {
    const alpha = 1 / (noiseFloor.samples + 1);
    noiseFloor.volume = noiseFloor.volume * (1 - alpha) + features.volume * alpha;
    noiseFloor.spectralCentroid = 
      noiseFloor.spectralCentroid * (1 - alpha) + features.spectralCentroid * alpha;
    noiseFloor.samples++;
  }
}

/**
 * Reset noise floor estimation (call when starting new session)
 */
export function resetNoiseFloor(): void {
  noiseFloor = {
    volume: 0,
    spectralCentroid: 0,
    samples: 0,
  };
}

// Temporal smoothing for VAD
const vadHistory: boolean[] = [];
const VAD_HISTORY_SIZE = 5; // Keep last 5 frames

/**
 * Enhanced Voice Activity Detection with:
 * - Multi-feature analysis
 * - Noise floor adaptation
 * - Temporal smoothing to reduce false positives
 * - Stricter requirements to prevent noise detection
 */
export function detectVoiceActivity(
  features: AudioFeatures,
  silenceThreshold: number = 0.02 // Stricter default threshold
): boolean {
  // Update noise floor during initial quiet periods
  if (features.volume < silenceThreshold * 2) {
    updateNoiseFloor(features);
  }

  // Adaptive threshold based on noise floor (more conservative)
  const volumeThreshold = Math.max(
    silenceThreshold,
    noiseFloor.volume * NOISE_MULTIPLIER * 1.2 // 20% more conservative
  );
  
  const hasVolume = features.volume > volumeThreshold;
  
  // Voice characteristics - much stricter requirements
  const hasValidPitch = features.pitch > 80 && features.pitch < 400;
  const hasVoiceLikeZCR = features.zeroCrossingRate > 0.01 && features.zeroCrossingRate < 0.3;
  const hasVoiceLikeSpectral = features.spectralCentroid > 200 && features.spectralCentroid < 3000;
  
  // Check formants - real speech has formants in expected ranges
  const hasValidFormants = 
    features.formants.f1 > 200 && features.formants.f1 < 1000 &&
    features.formants.f2 > 500 && features.formants.f2 < 3000;
  
  // Multi-feature scoring - require MORE indicators (stricter)
  const voiceScore = 
    (hasVolume ? 1 : 0) +
    (hasValidPitch ? 1 : 0) +
    (hasVoiceLikeZCR ? 1 : 0) +
    (hasVoiceLikeSpectral ? 1 : 0) +
    (hasValidFormants ? 1 : 0);
  
  // Need at least 3 indicators (was 2) to consider it voice - prevents noise
  const isVoice = voiceScore >= 3;
  
  // Temporal smoothing - require voice in majority of recent frames
  // This prevents brief noise spikes from being detected as speech
  vadHistory.push(isVoice);
  if (vadHistory.length > VAD_HISTORY_SIZE) {
    vadHistory.shift();
  }
  
  const voiceCount = vadHistory.filter(v => v).length;
  // Require 70% of recent frames (was 60%) to show voice activity - stricter
  return voiceCount >= Math.ceil(VAD_HISTORY_SIZE * 0.7);
}

/**
 * Normalize frequency data for visualization (0-1 range)
 */
export function normalizeFrequencyData(data: Uint8Array): number[] {
  const normalized: number[] = [];
  for (let i = 0; i < data.length; i++) {
    normalized.push(data[i] / 255);
  }
  return normalized;
}

/**
 * Downsample data for efficient visualization
 */
export function downsampleData(data: number[] | Uint8Array, targetLength: number): number[] {
  const result: number[] = [];
  const step = data.length / targetLength;
  
  for (let i = 0; i < targetLength; i++) {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);
    let sum = 0;
    for (let j = start; j < end && j < data.length; j++) {
      sum += data[j];
    }
    result.push(sum / (end - start));
  }
  
  return result;
}
