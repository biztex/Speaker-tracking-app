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
 * Estimate fundamental frequency (pitch) using enhanced autocorrelation
 * with parabolic interpolation for sub-sample accuracy
 */
export function estimatePitch(dataArray: ArrayLike<number>, sampleRate: number): number {
  const minPeriod = Math.floor(sampleRate / 500); // Max 500 Hz
  const maxPeriod = Math.floor(sampleRate / 50);  // Min 50 Hz
  
  // Normalize the signal
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
  const correlations: number[] = [];

  // Calculate autocorrelation with normalization
  for (let period = minPeriod; period < maxPeriod && period < normalized.length / 2; period++) {
    let correlation = 0;
    let norm = 0;
    
    for (let i = 0; i < normalized.length - period; i++) {
      correlation += normalized[i] * normalized[i + period];
      norm += normalized[i] * normalized[i];
    }
    
    const normalizedCorr = norm > 0 ? correlation / norm : 0;
    correlations.push(normalizedCorr);
    
    if (normalizedCorr > bestCorrelation) {
      secondBestCorrelation = bestCorrelation;
      bestCorrelation = normalizedCorr;
      bestPeriod = period;
    } else if (normalizedCorr > secondBestCorrelation) {
      secondBestCorrelation = normalizedCorr;
    }
  }

  // Require clear peak and good correlation strength
  const hasGoodPeak = bestCorrelation > 0.35 && bestCorrelation > secondBestCorrelation * 1.3;
  
  if (hasGoodPeak && bestPeriod > 0) {
    // Parabolic interpolation for sub-sample accuracy
    const idx = bestPeriod - minPeriod;
    if (idx > 0 && idx < correlations.length - 1) {
      const alpha = correlations[idx - 1];
      const beta = correlations[idx];
      const gamma = correlations[idx + 1];
      const offset = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma);
      const refinedPeriod = bestPeriod + offset;
      return sampleRate / refinedPeriod;
    }
    return sampleRate / bestPeriod;
  }
  
  return 0; // Invalid pitch
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
 * Extract formant frequencies (F1, F2, F3) with improved peak detection
 * Formants are resonant frequencies of the vocal tract - highly speaker-specific
 */
export function extractFormants(
  frequencyData: ArrayLike<number>,
  sampleRate: number,
  fftSize: number
): { f1: number; f2: number; f3: number } {
  const binWidth = sampleRate / fftSize;
  
  // Apply pre-emphasis to enhance formants
  const emphasized = new Float32Array(frequencyData.length);
  for (let i = 0; i < frequencyData.length; i++) {
    emphasized[i] = frequencyData[i];
  }
  
  // Smooth the spectrum to reduce noise
  const smoothed = new Float32Array(emphasized.length);
  const windowSize = 3;
  for (let i = 0; i < emphasized.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(emphasized.length - 1, i + windowSize); j++) {
      sum += emphasized[j];
      count++;
    }
    smoothed[i] = sum / count;
  }
  
  // Formant ranges for human speech (more precise)
  const f1Start = Math.floor(250 / binWidth);
  const f1End = Math.floor(900 / binWidth);
  const f2Start = Math.floor(850 / binWidth);
  const f2End = Math.floor(2800 / binWidth);
  const f3Start = Math.floor(2200 / binWidth);
  const f3End = Math.floor(3500 / binWidth);
  
  const f1 = findPeakInRange(smoothed, f1Start, f1End, binWidth);
  const f2 = findPeakInRange(smoothed, f2Start, f2End, binWidth);
  const f3 = findPeakInRange(smoothed, f3Start, f3End, binWidth);
  
  return { f1, f2, f3 };
}

/**
 * Calculate improved MFCC-like features with better mel-scale approximation
 * These are mel-frequency band energies optimized for speaker discrimination
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
    let weightSum = 0;
    
    for (let bin = binStart; bin <= binEnd; bin++) {
      // Triangular filter with proper normalization
      let weight = 0;
      if (bin < binCenter) {
        weight = (bin - binStart) / Math.max(1, binCenter - binStart);
      } else {
        weight = (binEnd - bin) / Math.max(1, binEnd - binCenter);
      }
      energy += frequencyData[bin] * weight;
      weightSum += weight;
    }
    
    // Normalize by weight sum
    bands[band] = weightSum > 0 ? energy / weightSum : 0;
  }

  // Log compression (like real MFCC)
  const logBands = bands.map(e => Math.log(Math.max(e, 1e-10)));
  
  // Normalize to 0-1 range
  const minLog = Math.min(...logBands);
  const maxLog = Math.max(...logBands);
  const range = maxLog - minLog;
  
  return range > 0 
    ? logBands.map(e => (e - minLog) / range)
    : logBands.map(() => 0);
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

const NOISE_ESTIMATION_SAMPLES = 15; // First 15 frames estimate noise (faster)
const NOISE_MULTIPLIER = 1.8; // Noise threshold = noise floor * this (balanced)

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
const VAD_HISTORY_SIZE = 4; // Keep last 4 frames (reduced for faster response)

/**
 * Enhanced Voice Activity Detection with improved multi-feature analysis
 * Uses adaptive thresholding and temporal smoothing
 */
export function detectVoiceActivity(
  features: AudioFeatures,
  silenceThreshold: number = 0.02
): boolean {
  // Update noise floor during initial quiet periods
  if (features.volume < silenceThreshold * 2) {
    updateNoiseFloor(features);
  }

  // Adaptive threshold based on noise floor
  const volumeThreshold = Math.max(
    silenceThreshold,
    noiseFloor.volume * NOISE_MULTIPLIER
  );
  
  const hasVolume = features.volume > volumeThreshold;
  
  // Voice characteristics with validated ranges
  const hasValidPitch = features.pitch > 85 && features.pitch < 400;
  const hasVoiceLikeZCR = features.zeroCrossingRate > 0.015 && features.zeroCrossingRate < 0.28;
  const hasVoiceLikeSpectral = features.spectralCentroid > 250 && features.spectralCentroid < 2800;
  
  // Check formants - real speech has formants in expected ranges
  const hasValidFormants = 
    features.formants.f1 > 250 && features.formants.f1 < 950 &&
    features.formants.f2 > 600 && features.formants.f2 < 2900;
  
  // Check MFCC energy distribution (voice has characteristic pattern)
  const mfccEnergy = features.mfcc.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const hasVoiceLikeMFCC = mfccEnergy > 0.1 && mfccEnergy < 0.9;
  
  // Multi-feature scoring with weighted importance
  let voiceScore = 0;
  voiceScore += hasVolume ? 1.5 : 0;           // Volume is important
  voiceScore += hasValidPitch ? 1.5 : 0;       // Pitch is very important
  voiceScore += hasVoiceLikeZCR ? 0.5 : 0;     // ZCR is supplementary
  voiceScore += hasVoiceLikeSpectral ? 1.0 : 0; // Spectral is important
  voiceScore += hasValidFormants ? 1.5 : 0;    // Formants are very important
  voiceScore += hasVoiceLikeMFCC ? 1.0 : 0;    // MFCC pattern is important
  
  // Need score >= 4.0 to consider it voice (balanced threshold)
  const isVoice = voiceScore >= 4.0;
  
  // Temporal smoothing - require voice in majority of recent frames
  vadHistory.push(isVoice);
  if (vadHistory.length > VAD_HISTORY_SIZE) {
    vadHistory.shift();
  }
  
  const voiceCount = vadHistory.filter(v => v).length;
  // Require 60% of recent frames to show voice activity
  return voiceCount >= Math.ceil(VAD_HISTORY_SIZE * 0.6);
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
