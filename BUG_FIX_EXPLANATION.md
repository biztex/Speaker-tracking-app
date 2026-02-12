# Bug Fix: New Speakers Not Being Created

## The Problem

Only Speaker 1 was being displayed, and when a different person spoke, no new speaker (Speaker 2) was created. The system kept assigning all speech to Speaker 1.

---

## Root Cause Analysis

### The Critical Bug

The bug was in the **order of operations** in the `detectSpeaker` function:

```
1. Calculate similarity to existing speakers
2. Add bestSpeakerId to history ← BUG HERE!
3. Check history for consistency
4. Decide if new speaker needed
```

### Why This Failed

When Speaker 2 talks for the first time:

1. **Similarity calculated**: Speaker 2's voice vs Speaker 1's profile = 0.3 (low, different person)
2. **bestSpeakerId = 0** (Speaker 1, because it's the only profile)
3. **History updated**: `[0, 0, 0, ...]` ← Filled with Speaker 0!
4. **Consistency check**: "Do we have 2+ frames of the same speaker?" → YES (all Speaker 0)
5. **Decision**: "We're consistent, so keep Speaker 0" ← WRONG!

The algorithm was checking for consistency of the MATCHED speaker (Speaker 0), not consistency of the LOW SIMILARITY that indicates a new speaker.

---

## The Fix

### Changed Logic Flow

```
1. Calculate similarity to existing speakers
2. Decide if new speaker needed (check LOW similarity consistency)
3. Add finalSpeakerId to history ← AFTER decision!
```

### New Speaker Detection Logic

**For LOW similarity (< 0.50):**
- Check recent confidence history
- Count frames with LOW similarity (< 0.50)
- If 2+ consecutive frames have low similarity → CREATE NEW SPEAKER
- This detects "consistently different" voices

**For HIGH similarity (>= 0.50):**
- Use temporal smoothing on speaker IDs
- Confirm match across multiple frames
- Switch speakers only with strong evidence

---

## Key Changes

### Before (Broken)
```typescript
// Add to history BEFORE decision
detector.speakerHistory.push(bestSpeakerId);  // Always Speaker 0!
detector.confidenceHistory.push(rawConfidence);

// Check consistency
const isConsistent = maxCount >= MIN_CONSECUTIVE_FRAMES;  // Always true!

if (isConsistent && hasConfidence) {
  // Never reaches here because checking wrong thing
  isNew = true;
}
```

### After (Fixed)
```typescript
// Check LOW similarity consistency for new speaker
if (bestSimilarity < SPEAKER_CHANGE_THRESHOLD) {
  const recentConfidences = detector.confidenceHistory.slice(-MIN_CONSECUTIVE_FRAMES);
  const lowSimilarityCount = recentConfidences.filter(c => c < SPEAKER_CHANGE_THRESHOLD).length;
  
  // If consistently LOW similarity → new speaker!
  if (lowSimilarityCount >= MIN_CONSECUTIVE_FRAMES) {
    isNew = true;
    finalSpeakerId = detector.speakerCount;
  }
}

// Add to history AFTER decision
detector.speakerHistory.push(finalSpeakerId);
detector.confidenceHistory.push(bestSimilarity);
```

---

## How It Works Now

### Scenario: Speaker 1 talks, then Speaker 2 talks

**Speaker 1 (frames 1-10):**
- Frame 1: No profiles → Create Speaker 0 ✓
- Frames 2-10: High similarity to Speaker 0 → Keep Speaker 0 ✓

**Speaker 2 starts (frame 11):**
- Frame 11: Similarity to Speaker 0 = 0.3 (low)
  - History: `[0.8, 0.9, 0.85, 0.87]` (all high from Speaker 1)
  - Low similarity count: 1 (just this frame)
  - Decision: Not consistent yet, keep Speaker 0
  
- Frame 12: Similarity to Speaker 0 = 0.32 (low)
  - History: `[0.9, 0.85, 0.87, 0.3]`
  - Low similarity count: 1 (still not enough)
  - Decision: Keep Speaker 0
  
- Frame 13: Similarity to Speaker 0 = 0.28 (low)
  - History: `[0.85, 0.87, 0.3, 0.32]`
  - Low similarity count: 2 (2 consecutive low!)
  - Decision: **CREATE SPEAKER 1** ✓

**Speaker 2 continues (frames 14+):**
- High similarity to Speaker 1's profile → Keep Speaker 1 ✓

---

## Testing Checklist

✓ **Two different speakers**: Should create Speaker 0 and Speaker 1
✓ **Rapid switching**: Should track both speakers correctly
✓ **Similar voices**: Should still create separate speakers if different enough
✓ **Same speaker continues**: Should not create duplicate speakers
✓ **Background noise**: Should not create speakers for noise

---

## Technical Details

### Thresholds
- `SPEAKER_CHANGE_THRESHOLD = 0.50` - Below this = different speaker
- `MIN_CONSECUTIVE_FRAMES = 2` - Need 2 frames to confirm
- `MIN_CONFIDENCE_FOR_SWITCH = 0.45` - Minimum confidence for decisions

### Detection Flow
1. Extract audio features (pitch, formants, MFCC)
2. Calculate similarity to all existing profiles
3. **If similarity < 0.50**: Check for consistently low similarity
4. **If consistently low**: Create new speaker
5. **If similarity >= 0.50**: Match to existing speaker
6. Update history with final decision

---

## Expected Behavior

### Normal Operation
- First speaker detected → Speaker 1 created
- Different speaker detected → Speaker 2 created (after 2 frames)
- Switching between speakers → Correctly tracks both
- Same speaker continues → No duplicate speakers

### Edge Cases
- Very similar voices → May take 3-4 frames to separate
- Brief interruptions → Maintains speaker identity
- Overlapping speech → Tracks dominant speaker
- Background noise → Rejected by VAD, no false speakers

---

## Conclusion

The bug was a **logic ordering issue**: we were checking consistency of the matched speaker instead of consistency of the mismatch. By moving the history update AFTER the decision and checking for consistently LOW similarity, new speakers are now properly detected.

The fix ensures that when a different person speaks, their consistently different voice characteristics trigger the creation of a new speaker profile.
