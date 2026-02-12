import type { AudioFeatures, VoiceProfile } from '../types';

/**
 * Enhanced speaker detection using multiple voice characteristics
 * Includes pitch, spectral centroid, and MFCC features for better accuracy
 */

const PROFILE_SAMPLES_THRESHOLD = 5; // Samples needed for stable profile (faster learning)
const SPEAKER_CHANGE_THRESHOLD = 0.50; // Similarity threshold - below this means different speaker
const SPEAKER_HISTORY_SIZE = 5; // History for temporal smoothing
const MIN_CONFIDENCE_FOR_SWITCH = 0.45; // Threshold for switching speakers
const MIN_CONSECUTIVE_FRAMES = 2; // Frames needed to confirm switch (faster response)
const OVERLAP_DETECTION_THRESHOLD = 0.45; // Threshold for detecting overlapping speakers
const MFCC_COEFFICIENTS = 10; // Use 10 MFCC coefficients for better discrimination
const PROFILE_UPDATE_RATE = 0.15; // How quickly profiles adapt (higher = faster adaptation)

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
 * Enhanced similarity calculation using multiple acoustic features
 * Uses weighted combination optimized for speaker discrimination
 * Returns a value between 0 (different) and 1 (same)
 */
export function calculateSimilarity(
  features: AudioFeatures,
  profile: VoiceProfile
): number {
  if (profile.samples < PROFILE_SAMPLES_THRESHOLD) {
    return 0.5; // Not enough data to make a determination
  }

  // 1. Pitch similarity with adaptive tolerance
  const pitchDiff = Math.abs(features.pitch - profile.avgPitch);
  const pitchStdDev = Math.sqrt(profile.pitchVariance);
  const pitchTolerance = Math.max(40, pitchStdDev * 1.5); // Tighter tolerance
  const pitchSimilarity = Math.max(0, 1 - pitchDiff / pitchTolerance);

  // 2. Spectral centroid similarity (voice brightness)
  const spectralDiff = Math.abs(features.spectralCentroid - profile.avgSpectralCentroid);
  const spectralSimilarity = Math.max(0, 1 - spectralDiff / 600); // Tighter tolerance

  // 3. MFCC similarity using cosine similarity (most discriminative)
  const mfccVec1 = features.mfcc.slice(0, MFCC_COEFFICIENTS);
  const mfccVec2 = profile.mfccProfile.length >= MFCC_COEFFICIENTS 
    ? profile.mfccProfile.slice(0, MFCC_COEFFICIENTS)
    : new Array(MFCC_COEFFICIENTS).fill(0);
  const mfccSimilarity = cosineSimilarity(mfccVec1, mfccVec2);

  // 4. Formant similarity - highly speaker-specific
  const formantSimilarity = profile.avgFormants
    ? calculateFormantSimilarity(features.formants, profile.avgFormants)
    : 0.5;

  // 5. Pitch range consistency (new feature)
  const pitchRangeSimilarity = profile.pitchVariance > 0
    ? Math.exp(-Math.abs(pitchStdDev - Math.sqrt(profile.pitchVariance)) / 30)
    : 0.5;

  // Weighted combination optimized for speaker discrimination
  // MFCC and formants are most discriminative, pitch provides additional context
  const similarity = (
    pitchSimilarity * 0.20 +
    spectralSimilarity * 0.10 +
    mfccSimilarity * 0.40 +      // Highest weight - most discriminative
    formantSimilarity * 0.25 +    // Second highest - very speaker-specific
    pitchRangeSimilarity * 0.05   // Additional context
  );

  return similarity;
}

/**
 * Update a voice profile with new features using adaptive learning rate
 */
export function updateProfile(
  profile: VoiceProfile,
  features: AudioFeatures
): VoiceProfile {
  // Adaptive learning rate - faster initially, slower as profile stabilizes
  const alpha = profile.samples < 10 
    ? PROFILE_UPDATE_RATE * 2  // Learn faster initially
    : Math.min(PROFILE_UPDATE_RATE, 1 / Math.sqrt(profile.samples + 1));
  
  const newAvgPitch = profile.avgPitch * (1 - alpha) + features.pitch * alpha;
  const newAvgSpectral = profile.avgSpectralCentroid * (1 - alpha) + features.spectralCentroid * alpha;
  
  // Update MFCC profile (10 coefficients for better discrimination)
  const mfccToUse = features.mfcc.slice(0, MFCC_COEFFICIENTS);
  const currentMfcc = profile.mfccProfile.length >= MFCC_COEFFICIENTS
    ? profile.mfccProfile 
    : new Array(MFCC_COEFFICIENTS).fill(0);
  
  const newMfcc = currentMfcc.map((val, i) => 
    val * (1 - alpha) + (mfccToUse[i] || 0) * alpha
  );
  
  // Update formants with validation
  const currentFormants = profile.avgFormants || features.formants;
  const hasValidNewFormants = 
    features.formants.f1 > 200 && features.formants.f1 < 1000 &&
    features.formants.f2 > 500 && features.formants.f2 < 3000;
  
  const newFormants = hasValidNewFormants ? {
    f1: currentFormants.f1 * (1 - alpha) + features.formants.f1 * alpha,
    f2: currentFormants.f2 * (1 - alpha) + features.formants.f2 * alpha,
    f3: currentFormants.f3 * (1 - alpha) + features.formants.f3 * alpha,
  } : currentFormants;
  
  // Update variance estimates with Welford's online algorithm
  const pitchDelta = features.pitch - profile.avgPitch;
  const pitchDelta2 = features.pitch - newAvgPitch;
  const pitchVariance = profile.pitchVariance + pitchDelta * pitchDelta2;
  
  // Calculate formant variance
  const formantVariance = profile.formantVariance || 0;
  const formantDiff = hasValidNewFormants ?
    Math.pow(features.formants.f1 - newFormants.f1, 2) +
    Math.pow(features.formants.f2 - newFormants.f2, 2) +
    Math.pow(features.formants.f3 - newFormants.f3, 2)
    : 0;
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
 * Detect which speaker is currently talking with improved accuracy
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

  // Validate pitch quality - if poor, maintain current speaker
  const hasPitch = features.pitch > 80 && features.pitch < 400;
  if (!hasPitch && detector.currentSpeakerId !== null) {
    detector.speakerHistory.push(detector.currentSpeakerId);
    detector.confidenceHistory.push(0.4);
    if (detector.speakerHistory.length > SPEAKER_HISTORY_SIZE) {
      detector.speakerHistory.shift();
      detector.confidenceHistory.shift();
    }
    return {
      speakerId: detector.currentSpeakerId,
      isNew: false,
      confidence: 0.4,
    };
  }

  // Calculate similarity to all existing profiles
  const similarities: Array<{ speakerId: number; similarity: number }> = [];
  let bestSpeakerId = -1;
  let bestSimilarity = 0;
  let secondBestSimilarity = 0;
  
  for (const [speakerId, profile] of detector.profiles) {
    const similarity = calculateSimilarity(features, profile);
    similarities.push({ speakerId, similarity });
    
    if (similarity > bestSimilarity) {
      secondBestSimilarity = bestSimilarity;
      bestSimilarity = similarity;
      bestSpeakerId = speakerId;
    } else if (similarity > secondBestSimilarity) {
      secondBestSimilarity = similarity;
    }
  }
  
  // Calculate confidence based on separation between best and second-best
  const separation = bestSimilarity - secondBestSimilarity;
  const confidenceBoost = Math.min(0.2, separation * 2); // Reward clear separation
  const rawConfidence = bestSimilarity + confidenceBoost;
  
  // Overlap detection: multiple speakers with similar scores
  const highSimilaritySpeakers = similarities.filter(s => s.similarity > OVERLAP_DETECTION_THRESHOLD);
  const isOverlapping = highSimilaritySpeakers.length >= 2 && separation < 0.15;
  
  if (isOverlapping) {
    // Use the most confident match (dominant speaker)
    highSimilaritySpeakers.sort((a, b) => b.similarity - a.similarity);
    bestSpeakerId = highSimilaritySpeakers[0].speakerId;
    bestSimilarity = highSimilaritySpeakers[0].similarity;
  }

  // Decision logic for speaker assignment
  let isNew = false;
  let finalSpeakerId = bestSpeakerId;
  
  if (bestSimilarity < SPEAKER_CHANGE_THRESHOLD) {
    // Low similarity to all existing speakers - potentially new speaker
    if (detector.speakerCount < detector.maxSpeakers) {
      // For new speaker detection, check if we've had consistently LOW similarity
      // Look at recent history to see if we've been mismatching
      const recentHistory = detector.speakerHistory.slice(-MIN_CONSECUTIVE_FRAMES);
      const recentConfidences = detector.confidenceHistory.slice(-MIN_CONSECUTIVE_FRAMES);
      
      // Count how many recent frames had low similarity (indicating different speaker)
      const lowSimilarityCount = recentConfidences.filter(c => c < SPEAKER_CHANGE_THRESHOLD).length;
      
      // If we've had consistently low similarity, create new speaker
      if (lowSimilarityCount >= MIN_CONSECUTIVE_FRAMES || recentHistory.length < MIN_CONSECUTIVE_FRAMES) {
        // Create new speaker
        isNew = true;
        finalSpeakerId = detector.speakerCount;
      } else {
        // Not consistent enough - keep current or use best match
        finalSpeakerId = detector.currentSpeakerId ?? bestSpeakerId;
      }
    } else {
      // Max speakers reached - assign to best match
      finalSpeakerId = bestSpeakerId >= 0 ? bestSpeakerId : (detector.currentSpeakerId ?? 0);
    }
  } else {
    // Good similarity to an existing speaker
    // Use temporal smoothing to confirm the match
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
    
    if (maxCount >= MIN_CONSECUTIVE_FRAMES) {
      // Consistently matching - use temporal smoothing result
      finalSpeakerId = mostCommonSpeaker;
    } else {
      // Not consistent yet - be cautious about switching
      if (detector.currentSpeakerId !== null && bestSpeakerId !== detector.currentSpeakerId) {
        // Only switch if we have strong evidence
        const shouldSwitch = rawConfidence >= MIN_CONFIDENCE_FOR_SWITCH && separation > 0.1;
        finalSpeakerId = shouldSwitch ? bestSpeakerId : detector.currentSpeakerId;
      } else {
        finalSpeakerId = bestSpeakerId;
      }
    }
  }

  // Add to history AFTER decision (use the actual similarity, not boosted confidence)
  detector.speakerHistory.push(finalSpeakerId);
  detector.confidenceHistory.push(bestSimilarity);
  
  if (detector.speakerHistory.length > SPEAKER_HISTORY_SIZE) {
    detector.speakerHistory.shift();
    detector.confidenceHistory.shift();
  }

  // Calculate average confidence for reporting
  const recentConfidences = detector.confidenceHistory.slice(-MIN_CONSECUTIVE_FRAMES);
  const avgConfidence = recentConfidences.length > 0
    ? recentConfidences.reduce((a, b) => a + b, 0) / recentConfidences.length
    : bestSimilarity;

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
