# How the Speaker Analysis System Works

## Overview

The system analyzes speakers in real-time by extracting unique voice characteristics (acoustic features) and comparing them to build speaker profiles. It's like a voice fingerprint system that identifies who is speaking without recording or transcribing the actual words.

---

## Step-by-Step Process

### 1. Audio Capture (Every ~20ms)

```
Microphone → Web Audio API → Real-time Processing
```

- Captures audio at 44,100 Hz sample rate
- Processes in chunks of 2048 samples (~46ms windows)
- Uses browser's built-in echo cancellation and noise suppression
- **No audio is stored** - only analyzed in real-time

---

### 2. Feature Extraction

The system extracts 6 key voice characteristics that are unique to each person:

#### A. **Pitch (Fundamental Frequency)**
- **What it is**: How high or low someone's voice sounds
- **Range**: 85-400 Hz (typical human speech)
- **How it's measured**: Autocorrelation algorithm finds the repeating pattern in voice
- **Why it matters**: Men typically 85-180 Hz, women 165-255 Hz, children higher
- **Example**: Morgan Freeman (low ~80 Hz) vs. Ariana Grande (high ~250 Hz)

```typescript
// Simplified concept
pitch = findRepeatingPattern(audioWaveform)
// Result: 120 Hz (male voice) or 220 Hz (female voice)
```

#### B. **Formants (F1, F2, F3)**
- **What they are**: Resonant frequencies of your vocal tract (throat, mouth, nose)
- **Why they matter**: Determined by physical anatomy - unique like fingerprints
- **Ranges**:
  - F1 (250-900 Hz): Mouth opening, jaw position
  - F2 (850-2800 Hz): Tongue position, vowel quality
  - F3 (2200-3500 Hz): Lip rounding, nasal quality
- **Example**: "ah" vs "ee" sound - same pitch, different formants

```typescript
// Formants are peaks in the frequency spectrum
F1 = findPeakInRange(250-900 Hz)   // e.g., 650 Hz
F2 = findPeakInRange(850-2800 Hz)  // e.g., 1720 Hz
F3 = findPeakInRange(2200-3500 Hz) // e.g., 2850 Hz
```

#### C. **MFCC (Mel-Frequency Cepstral Coefficients)**
- **What they are**: 10 numbers representing the overall "color" or "texture" of voice
- **Why they matter**: Captures the unique spectral envelope of each voice
- **How it works**: Mimics how human ears perceive sound (mel scale)
- **Example**: Like a voice "barcode" - [0.2, 0.5, 0.3, 0.7, 0.1, 0.4, 0.6, 0.2, 0.3, 0.5]

```typescript
// Simplified concept
mfcc = [
  0.45,  // Low frequency energy
  0.62,  // Mid-low energy
  0.38,  // Mid energy
  0.71,  // Mid-high energy
  // ... 6 more coefficients
]
```

#### D. **Spectral Centroid**
- **What it is**: The "center of mass" of the sound spectrum
- **Range**: 250-2800 Hz
- **Why it matters**: Indicates voice "brightness" or "darkness"
- **Example**: Bright voice (high centroid) vs. deep voice (low centroid)

#### E. **Zero Crossing Rate (ZCR)**
- **What it is**: How often the audio waveform crosses zero
- **Range**: 0.015-0.28
- **Why it matters**: Helps distinguish voice from noise
- **Example**: Voice has regular crossings, noise is random

#### F. **Volume (RMS Energy)**
- **What it is**: How loud the voice is
- **Why it matters**: Confirms someone is actually speaking
- **Note**: Normalized to account for microphone distance

---

### 3. Voice Activity Detection (VAD)

Before analyzing speakers, the system checks: "Is this actually speech?"

#### Multi-Feature Scoring System

```typescript
Score = 0
if (volume > threshold)           Score += 1.5  // Someone is making sound
if (pitch is 85-400 Hz)           Score += 1.5  // Human voice range
if (ZCR is 0.015-0.28)            Score += 0.5  // Voice-like pattern
if (spectral is 250-2800 Hz)      Score += 1.0  // Voice frequency range
if (formants are valid)           Score += 1.5  // Real vocal tract
if (MFCC pattern is voice-like)   Score += 1.0  // Voice texture

if (Score >= 4.0) → "Voice detected!"
else → "Silence or noise"
```

#### Temporal Smoothing
- Checks last 4 frames (80ms)
- Needs 60% to show voice (2.4 out of 4 frames)
- Prevents brief noise spikes from being detected as speech

---

### 4. Speaker Profile Creation

When the first speaker talks, the system creates a profile:

```typescript
Speaker 0 Profile = {
  avgPitch: 145 Hz,
  avgSpectralCentroid: 1250 Hz,
  avgFormants: { f1: 650, f2: 1720, f3: 2850 },
  mfccProfile: [0.45, 0.62, 0.38, 0.71, ...],
  pitchVariance: 125,  // How much pitch varies
  samples: 1           // Number of frames analyzed
}
```

As the speaker continues, the profile is updated:

```typescript
// Adaptive learning - fast initially, slower as profile stabilizes
learningRate = samples < 10 ? 0.30 : 0.15

newAvgPitch = oldAvgPitch * (1 - learningRate) + currentPitch * learningRate
// Example: 145 * 0.85 + 148 * 0.15 = 145.45 Hz
```

---

### 5. Speaker Identification

When new audio comes in, the system compares it to all existing profiles:

#### Similarity Calculation

```typescript
// Compare current features to Speaker 0's profile

pitchSimilarity = 1 - |currentPitch - profilePitch| / tolerance
// Example: 1 - |148 - 145| / 60 = 0.95 (very similar)

spectralSimilarity = 1 - |currentSpectral - profileSpectral| / 600
// Example: 1 - |1280 - 1250| / 600 = 0.95 (very similar)

mfccSimilarity = cosineSimilarity(currentMFCC, profileMFCC)
// Example: 0.92 (high similarity)

formantSimilarity = compareFormants(current, profile)
// Example: 0.88 (good match)

// Weighted combination (optimized for discrimination)
totalSimilarity = 
  pitchSimilarity * 0.20 +
  spectralSimilarity * 0.10 +
  mfccSimilarity * 0.40 +      // Highest weight
  formantSimilarity * 0.25 +
  pitchRangeSimilarity * 0.05

// Result: 0.91 (91% match to Speaker 0)
```

#### Decision Logic

```typescript
if (similarity >= 0.50) {
  // Good match to existing speaker
  return "Speaker 0"
  
} else if (similarity < 0.50) {
  // Low similarity - potentially new speaker
  
  // Check if consistently different for 2+ frames
  if (last 2 frames also had similarity < 0.50) {
    // Create new speaker!
    return "Speaker 1 (NEW)"
  } else {
    // Not consistent yet, wait
    return "Speaker 0 (tentative)"
  }
}
```

---

### 6. Real-World Example

#### Scenario: Two people having a conversation

**Frame 1-10: Person A speaks**
```
Frame 1: No profiles exist
  → Create Speaker 0 with Person A's features
  
Frame 2-10: Features match Speaker 0 (similarity ~0.85)
  → Continue tracking Speaker 0
  → Update Speaker 0's profile with new data
```

**Frame 11-13: Person B starts speaking**
```
Frame 11: 
  Features: pitch=220Hz, F1=580, F2=2100, MFCC=[0.3, 0.7, ...]
  Compare to Speaker 0: similarity = 0.32 (low!)
  History: [0.85, 0.87, 0.89, 0.32] ← 1 low frame
  Decision: Not consistent yet, keep Speaker 0
  
Frame 12:
  Features: pitch=218Hz, F1=590, F2=2080, MFCC=[0.31, 0.68, ...]
  Compare to Speaker 0: similarity = 0.35 (low!)
  History: [0.87, 0.89, 0.32, 0.35] ← 2 low frames!
  Decision: CREATE SPEAKER 1 ✓
  
Frame 13+:
  Features match Speaker 1 (similarity ~0.82)
  → Continue tracking Speaker 1
  → Update Speaker 1's profile
```

**Frame 20+: Person A speaks again**
```
Frame 20:
  Features: pitch=145Hz, F1=650, F2=1720, MFCC=[0.45, 0.62, ...]
  Compare to Speaker 0: similarity = 0.88 (high!)
  Compare to Speaker 1: similarity = 0.31 (low)
  Decision: Switch back to Speaker 0 ✓
```

---

## Why This Works

### 1. Multiple Features = Better Accuracy
- Using 6 different features (not just pitch) makes it robust
- Even if one feature is similar, others will differ
- Like identifying someone by height + weight + eye color + fingerprint

### 2. Adaptive Learning
- Profiles improve over time as more samples are collected
- Accounts for natural voice variations (louder/softer, tired, etc.)
- Fast learning initially, stable later

### 3. Temporal Smoothing
- Requires consistency across multiple frames (2+)
- Prevents noise or brief sounds from creating false speakers
- Reduces jitter and rapid switching

### 4. Confidence-Based Decisions
- Only creates new speakers when consistently different
- Only switches speakers with strong evidence
- Maintains current speaker during ambiguous audio

---

## What Makes Voices Different?

### Physical Factors
1. **Vocal cord length/thickness** → Pitch
2. **Vocal tract shape** (throat, mouth, nose) → Formants
3. **Articulation style** → MFCC patterns
4. **Resonance characteristics** → Spectral centroid

### Example Differences

**Male vs Female:**
- Pitch: 120 Hz vs 220 Hz (major difference)
- Formants: Lower vs higher (anatomical)
- Spectral: Darker vs brighter

**Two Males:**
- Pitch: 130 Hz vs 145 Hz (moderate difference)
- Formants: F1=650 vs F1=700, F2=1720 vs F2=1650 (subtle but measurable)
- MFCC: Different spectral envelopes (unique "voice print")

---

## Limitations

### What the System CAN'T Do
- **Record audio** - Only analyzes in real-time
- **Transcribe speech** - Doesn't know what words are said
- **Identify specific people** - Doesn't know "this is John"
- **Work with recordings** - Only live microphone input
- **Handle 6+ speakers** - Limited to 5 speakers max

### Challenging Scenarios
- Very similar voices (twins, family members)
- Whispering or shouting (extreme variations)
- Heavy background noise
- Multiple people talking simultaneously
- Very short utterances (< 200ms)

---

## Performance Characteristics

### Speed
- Feature extraction: ~5ms per frame
- Similarity calculation: ~1ms per profile
- Total latency: 100-200ms (imperceptible)

### Accuracy (Expected)
- 2 speakers, clear audio: 90-95%
- 3-4 speakers, clear audio: 80-90%
- 5 speakers, clear audio: 75-85%
- Noisy environment: 70-80%

### Resource Usage
- CPU: ~5-10% (single core)
- Memory: ~10MB
- No network required (100% local)

---

## Privacy & Security

### What's Stored
- **Nothing permanently** - All processing is real-time
- **No audio files** - Audio is never saved
- **No transcripts** - Words are not captured
- **Only timing data** - How long each speaker talked

### What's Analyzed
- Acoustic features only (pitch, formants, MFCC)
- Features are discarded after each frame
- Speaker profiles exist only during session
- Everything resets when you press Stop

---

## Summary

The system works like a real-time voice fingerprint analyzer:

1. **Captures** audio every 20ms
2. **Extracts** 6 unique voice characteristics
3. **Checks** if it's actually speech (VAD)
4. **Compares** to existing speaker profiles
5. **Decides** if it's a known speaker or new speaker
6. **Tracks** speaking time for each speaker
7. **Updates** profiles to improve accuracy

It's all done locally in your browser with no recording, no transcription, and no data storage - just real-time analysis of who is speaking and for how long.
