import type { AudioFeatures, VoiceProfile } from '../types';

/**
 * Enhanced speaker detection using multiple voice characteristics
 * Includes pitch, spectral centroid, and MFCC features for better accuracy
 */

const PROFILE_SAMPLES_THRESHOLD = 10; // Increased for more stable profiles
const SPEAKER_CHANGE_THRESHOLD = 0.6; // Increased to require more difference between speakers
const SPEAKER_HISTORY_SIZE = 7; // Keep last 7 detections for temporal smoothing
const MIN_CONFIDENCE_FOR_SWITCH = 0.65; // Require 65% confidence to switch speakers
const MIN_CONSECUTIVE_FRAMES = 4; // Require 4 consecutive frames to confirm switch (more stable)
const OVERLAP_DETECTION_THRESHOLD = 0.45; // Threshold for detecting overlapping speakers
const MFCC_COEFFICIENTS = 8; // Use 8 MFCC coefficients (was 5)

export interface SpeakerDetector {
  profiles: Map<number, VoiceProfile>;
  currentSpeakerId: number | null;
  lastFeatures: AudioFeatures | null;
  speakerCount: number;
  maxSpeakers: number;
  // Temporal smoothing fields
  speakerHistory: number[];
  confidenceHistory: number[];
}

export function createSpeakerDetector(maxSpeakers: number = 5): SpeakerDetector {
  return {
    profiles: new Map(),
    currentSpeakerId: null,
    lastFeatures: null,
    speakerCount: 0,
    maxSpeakers,
    speakerHistory: [],
    confidenceHistory: [],
  };
}

/**
 * Calculate cosine similarity between two feature vectors
 * Better for high-dimensional features like MFCC
 */
function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec2.length === 0 || vec1.length === 0) return 0.5;
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  const minLength = Math.min(vec1.length, vec2.length);
  
  for (let i = 0; i < minLength; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  
  const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
  return denominator > 0 ? Math.max(0, dotProduct / denominator) : 0;
}

/**
 * Calculate formant similarity - formants are very speaker-specific
 */
function calculateFormantSimilarity(
  formants1: { f1: number; f2: number; f3: number },
  formants2: { f1: number; f2: number; f3: number }
): number {
  // Check if formants are valid (non-zero)
  const hasValidFormants1 = formants1.f1 > 0 && formants1.f2 > 0 && formants1.f3 > 0;
  const hasValidFormants2 = formants2.f1 > 0 && formants2.f2 > 0 && formants2.f3 > 0;
  
  if (!hasValidFormants1 || !hasValidFormants2) {
    return 0.5; // Neutral similarity if formants are invalid
  }
  
  // Normalize formants to similar scales
  const f1Diff = Math.abs(formants1.f1 - formants2.f1) / 500; // Normalize by typical range
  const f2Diff = Math.abs(formants1.f2 - formants2.f2) / 1500;
  const f3Diff = Math.abs(formants1.f3 - formants2.f3) / 1000;
  
  const avgDiff = (f1Diff + f2Diff + f3Diff) / 3;
  return Math.max(0, 1 - avgDiff);
}

/**
 * Enhanced similarity calculation using pitch, spectral centroid, MFCC, and formants
 * Uses cosine similarity for high-dimensional features
 * Returns a value between 0 (different) and 1 (same)
 */
export function calculateSimilarity(
  features: AudioFeatures,
  profile: VoiceProfile
): number {
  if (profile.samples < PROFILE_SAMPLES_THRESHOLD) {
    return 0.5; // Not enough data to make a determination
  }

  // Pitch similarity with adaptive tolerance based on variance
  const pitchDiff = Math.abs(features.pitch - profile.avgPitch);
  const pitchStdDev = Math.sqrt(profile.pitchVariance);
  const pitchTolerance = Math.max(50, pitchStdDev * 2); // Adaptive tolerance
  const pitchSimilarity = Math.max(0, 1 - pitchDiff / pitchTolerance);

  // Spectral centroid similarity (tighter tolerance)
  const spectralDiff = Math.abs(features.spectralCentroid - profile.avgSpectralCentroid);
  const spectralSimilarity = Math.max(0, 1 - spectralDiff / 800); // 800 Hz tolerance

  // MFCC similarity using cosine similarity (better for high-dimensional data)
  // Use 8 coefficients for better discrimination
  const mfccVec1 = features.mfcc.slice(0, MFCC_COEFFICIENTS);
  const mfccVec2 = profile.mfccProfile.length >= MFCC_COEFFICIENTS 
    ? profile.mfccProfile.slice(0, MFCC_COEFFICIENTS)
    : new Array(MFCC_COEFFICIENTS).fill(0);
  const mfccSimilarity = cosineSimilarity(mfccVec1, mfccVec2);

  // Formant similarity - very speaker-specific
  const formantSimilarity = profile.avgFormants
    ? calculateFormantSimilarity(features.formants, profile.avgFormants)
    : 0.5; // Neutral if formants not yet available

  // Weighted combination - formants and MFCC are most discriminative
  return (
    pitchSimilarity * 0.25 +
    spectralSimilarity * 0.15 +
    mfccSimilarity * 0.35 +
    formantSimilarity * 0.25
  );
}

/**
 * Update a voice profile with new features (including MFCC and formants)
 */
export function updateProfile(
  profile: VoiceProfile,
  features: AudioFeatures
): VoiceProfile {
  const alpha = Math.min(0.1, 1 / (profile.samples + 1)); // Exponential moving average
  
  const newAvgPitch = profile.avgPitch * (1 - alpha) + features.pitch * alpha;
  const newAvgSpectral = profile.avgSpectralCentroid * (1 - alpha) + features.spectralCentroid * alpha;
  
  // Update MFCC profile (8 coefficients)
  const mfccToUse = features.mfcc.slice(0, MFCC_COEFFICIENTS);
  const currentMfcc = profile.mfccProfile.length >= MFCC_COEFFICIENTS
    ? profile.mfccProfile 
    : new Array(MFCC_COEFFICIENTS).fill(0);
  
  const newMfcc = currentMfcc.map((val, i) => 
    val * (1 - alpha) + (mfccToUse[i] || 0) * alpha
  );
  
  // Update formants (initialize if not present)
  const currentFormants = profile.avgFormants || features.formants;
  const newFormants = {
    f1: currentFormants.f1 * (1 - alpha) + features.formants.f1 * alpha,
    f2: currentFormants.f2 * (1 - alpha) + features.formants.f2 * alpha,
    f3: currentFormants.f3 * (1 - alpha) + features.formants.f3 * alpha,
  };
  
  // Update variance estimates
  const pitchVariance = profile.pitchVariance * (1 - alpha) + 
    Math.pow(features.pitch - newAvgPitch, 2) * alpha;
  
  // Calculate formant variance (average of F1, F2, F3 variances)
  const formantVariance = profile.formantVariance || 0;
  const formantDiff = 
    Math.pow(features.formants.f1 - newFormants.f1, 2) +
    Math.pow(features.formants.f2 - newFormants.f2, 2) +
    Math.pow(features.formants.f3 - newFormants.f3, 2);
  const newFormantVariance = formantVariance * (1 - alpha) + (formantDiff / 3) * alpha;

  return {
    ...profile,
    avgPitch: newAvgPitch,
    avgSpectralCentroid: newAvgSpectral,
    pitchVariance,
    samples: profile.samples + 1,
    mfccProfile: newMfcc,
    avgFormants: newFormants,
    formantVariance: newFormantVariance,
  };
}

/**
 * Create a new voice profile from features (including MFCC and formants)
 */
export function createProfile(speakerId: number, features: AudioFeatures): VoiceProfile {
  return {
    speakerId,
    avgPitch: features.pitch,
    avgSpectralCentroid: features.spectralCentroid,
    pitchVariance: 0,
    samples: 1,
    mfccProfile: features.mfcc.slice(0, MFCC_COEFFICIENTS), // Store 8 MFCC coefficients
    avgFormants: { ...features.formants },
    formantVariance: 0,
  };
}

/**
 * Detect which speaker is currently talking with temporal smoothing
 * Returns the speaker ID and whether it's a new speaker
 */
export function detectSpeaker(
  detector: SpeakerDetector,
  features: AudioFeatures
): { speakerId: number; isNew: boolean; confidence: number } {
  // If no profiles exist yet, create the first speaker
  if (detector.profiles.size === 0) {
    return {
      speakerId: 0,
      isNew: true,
      confidence: 1.0,
    };
  }

  // If pitch is invalid but we have a current speaker, keep it
  // This prevents constant speaker switching during unclear audio
  const hasPitch = features.pitch > 80 && features.pitch < 400; // Stricter range
  if (!hasPitch && detector.currentSpeakerId !== null) {
    // Add to history to maintain continuity
    detector.speakerHistory.push(detector.currentSpeakerId);
    detector.confidenceHistory.push(0.5);
    if (detector.speakerHistory.length > SPEAKER_HISTORY_SIZE) {
      detector.speakerHistory.shift();
      detector.confidenceHistory.shift();
    }
    return {
      speakerId: detector.currentSpeakerId,
      isNew: false,
      confidence: 0.5,
    };
  }

  let bestSpeakerId = -1;
  let bestSimilarity = 0;

  // Compare with existing profiles
  const similarities: Array<{ speakerId: number; similarity: number }> = [];
  
  for (const [speakerId, profile] of detector.profiles) {
    const similarity = calculateSimilarity(features, profile);
    similarities.push({ speakerId, similarity });
    
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestSpeakerId = speakerId;
    }
  }
  
  // Overlap detection: if multiple speakers have high similarity, might be overlapping
  const highSimilaritySpeakers = similarities.filter(s => s.similarity > OVERLAP_DETECTION_THRESHOLD);
  const isOverlapping = highSimilaritySpeakers.length >= 2;
  
  // If overlapping, use the most confident match (dominant speaker)
  // In future, could track both speakers simultaneously
  if (isOverlapping) {
    // Sort by similarity and use the most confident
    highSimilaritySpeakers.sort((a, b) => b.similarity - a.similarity);
    bestSpeakerId = highSimilaritySpeakers[0].speakerId;
    bestSimilarity = highSimilaritySpeakers[0].similarity;
  }

  // Add to history for temporal smoothing
  detector.speakerHistory.push(bestSpeakerId);
  detector.confidenceHistory.push(bestSimilarity);
  
  if (detector.speakerHistory.length > SPEAKER_HISTORY_SIZE) {
    detector.speakerHistory.shift();
    detector.confidenceHistory.shift();
  }

  // Temporal smoothing: use mode of recent detections
  const recentSpeakers = detector.speakerHistory.slice(-MIN_CONSECUTIVE_FRAMES);
  const speakerCounts = new Map<number, number>();
  recentSpeakers.forEach(id => {
    if (id >= 0) {
      speakerCounts.set(id, (speakerCounts.get(id) || 0) + 1);
    }
  });
  
  let mostCommonSpeaker = bestSpeakerId;
  let maxCount = 0;
  speakerCounts.forEach((count, id) => {
    if (count > maxCount) {
      maxCount = count;
      mostCommonSpeaker = id;
    }
  });
  
  // Calculate average confidence for recent frames
  const recentConfidences = detector.confidenceHistory.slice(-MIN_CONSECUTIVE_FRAMES);
  const avgConfidence = recentConfidences.length > 0
    ? recentConfidences.reduce((a, b) => a + b, 0) / recentConfidences.length
    : bestSimilarity;

  // Decide if this is a new speaker or matches an existing one
  let isNew = false;
  let finalSpeakerId = bestSpeakerId;
  
  // Only switch if:
  // 1. Confidence is high enough
  // 2. Speaker is consistent across recent frames
  // 3. It's significantly different from current speaker
  const shouldSwitch = 
    mostCommonSpeaker !== detector.currentSpeakerId &&
    avgConfidence >= MIN_CONFIDENCE_FOR_SWITCH &&
    maxCount >= MIN_CONSECUTIVE_FRAMES &&
    bestSimilarity < SPEAKER_CHANGE_THRESHOLD;
  
  if (shouldSwitch && detector.speakerCount < detector.maxSpeakers) {
    // New speaker detected
    isNew = true;
    finalSpeakerId = detector.speakerCount;
  } else if (bestSimilarity < SPEAKER_CHANGE_THRESHOLD && detector.speakerCount < detector.maxSpeakers) {
    // Low similarity but don't switch yet - use temporal smoothing result
    finalSpeakerId = mostCommonSpeaker >= 0 ? mostCommonSpeaker : (detector.currentSpeakerId ?? 0);
  } else if (bestSpeakerId === -1) {
    // Fallback: if no match found at all, use current speaker or speaker 0
    finalSpeakerId = detector.currentSpeakerId ?? 0;
  } else {
    // Use the best matching speaker (with temporal smoothing)
    finalSpeakerId = mostCommonSpeaker >= 0 ? mostCommonSpeaker : bestSpeakerId;
  }

  return {
    speakerId: finalSpeakerId,
    isNew,
    confidence: avgConfidence,
  };
}

/**
 * Process audio features and update speaker detection state
 */
export function processSpeakerDetection(
  detector: SpeakerDetector,
  features: AudioFeatures
): {
  detector: SpeakerDetector;
  speakerId: number;
  isNewSpeaker: boolean;
  confidence: number;
} {
  const { speakerId, isNew, confidence } = detectSpeaker(detector, features);

  const newProfiles = new Map(detector.profiles);

  if (speakerId >= 0) {
    if (isNew) {
      // Create new profile
      newProfiles.set(speakerId, createProfile(speakerId, features));
    } else if (newProfiles.has(speakerId)) {
      // Update existing profile
      const existingProfile = newProfiles.get(speakerId)!;
      newProfiles.set(speakerId, updateProfile(existingProfile, features));
    }
  }

  return {
    detector: {
      profiles: newProfiles,
      currentSpeakerId: speakerId >= 0 ? speakerId : detector.currentSpeakerId,
      lastFeatures: features,
      speakerCount: isNew ? detector.speakerCount + 1 : detector.speakerCount,
      maxSpeakers: detector.maxSpeakers,
      // Preserve history for temporal smoothing
      speakerHistory: detector.speakerHistory,
      confidenceHistory: detector.confidenceHistory,
    },
    speakerId,
    isNewSpeaker: isNew,
    confidence,
  };
}

/**
 * Reset the speaker detector (clears all history)
 */
export function resetDetector(maxSpeakers: number = 5): SpeakerDetector {
  return createSpeakerDetector(maxSpeakers);
}

/**
 * Get speaker statistics
 */
export function getSpeakerStats(profiles: Map<number, VoiceProfile>): {
  speakerId: number;
  avgPitch: number;
  samples: number;
}[] {
  const stats: { speakerId: number; avgPitch: number; samples: number }[] = [];
  
  for (const [speakerId, profile] of profiles) {
    stats.push({
      speakerId,
      avgPitch: profile.avgPitch,
      samples: profile.samples,
    });
  }
  
  return stats.sort((a, b) => a.speakerId - b.speakerId);
}
