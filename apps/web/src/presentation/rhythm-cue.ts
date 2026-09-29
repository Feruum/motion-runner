import type { RhythmSnapshot } from '../../../../packages/game/src/core/rhythm-types';
import type { Lane } from '../../../../packages/game/src/core/types';

// Leave time for a human reaction and the smoothed, held-hand jump trigger.
export const RHYTHM_HIGH_JUMP_CUE_LEAD_MS = 850;

/** Explain the approaching object, including time for camera recognition and jump ascent. */
export function rhythmRunCue(snapshot: RhythmSnapshot, lane: Lane, handsDown: boolean, jumpHeight = 0, handsUp = false) {
  const star = snapshot.stars.find(item => item.status === 'upcoming');
  const remaining = star ? star.atMs - snapshot.elapsedMs : Infinity;
  const jumpNow = star?.height === 'high' && remaining <= RHYTHM_HIGH_JUMP_CUE_LEAD_MS;
  const label = star && star.id < 4 ? `LEARN TO COLLECT · STAR ${star.id + 1} OF 4` : 'RHYTHM RUN · CATCH THE STARS';
  if (snapshot.feedback && !jumpNow) return { title:snapshot.feedback,icon:snapshot.feedbackKind === 'good' ? '★' : '↗',tone:snapshot.feedbackKind,label:snapshot.feedbackKind === 'good' ? 'STAR COLLECTED · KEEP GOING' : 'STAR MISSED · TRY THE NEXT ONE' };
  if (!star) return { title:'All stars passed · see your score',icon:'★',tone:'neutral',label };
  if (star.height === 'high') {
    if (lane !== star.lane) return { title:'Return to center · high star ahead',icon:'↔',tone:'warning',label };
    if (jumpHeight > .1) return { title:'Reach the high star · jump in progress',icon:'↑',tone:'jump',label };
    if (!handsDown && handsUp) return { title:'Lower both hands to prepare your jump',icon:'↓',tone:'warning',label };
    return { title:jumpNow ? 'Raise both hands · jump for the star' : 'High star ahead · get ready to jump',icon:'↑',tone:jumpNow ? 'jump' : 'neutral',label };
  }
  const side=star.lane === -1 ? 'left' : star.lane === 1 ? 'right' : 'center';
  return { title:lane === star.lane ? `Stay ${side} · the star is coming to you` : `Lean ${side} · collect the low star`,icon:star.lane === -1 ? '←' : '→',tone:lane === star.lane ? 'safe' : 'neutral',label };
}
