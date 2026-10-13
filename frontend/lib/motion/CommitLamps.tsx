'use client';

/**
 * The commit lamps.
 *
 * Flat SVG, drawn here rather than imported, for two reasons.
 *
 * The obvious one is that a 3D bulb does not belong on this page. Everything
 * else on it is flat: the source site's motion, the stickers, the cards, the
 * marquee. Four glossy capsules lit by an emissive material read as a different
 * website pasted into a different website, and they were the only thing on the
 * page that needed a WebGL context to exist at all.
 *
 * The other is that this is a diagram, not an object. What it has to say is
 * "which of these four steps has the chain reached". A flat mark with a distinct
 * silhouette per state says that at a glance and costs nothing to render.
 *
 * The silhouettes carry the meaning on their own -- square, disc, triangle,
 * ring -- so the sequence still reads without colour vision, and the colour is
 * reinforcement rather than the only signal. Unreached states are outline only.
 * No three.js, no canvas, no context: the panel works when WebGL is unavailable
 * or disabled, which is the same fallback list the old version had to keep.
 */

import { COMMIT_STATES } from '@/lib/content';
import { COMMIT_STATES as RIG_STATES } from '@/lib/motion/rig';

export function CommitLamps({ reached, connected }: { reached: string | null; connected: boolean }) {
  return (
    <ul className="commit-lamps" data-reached={reached ?? ''}>
      {RIG_STATES.map((state, i) => {
        const meta = COMMIT_STATES[i];
        const lit = connected && reached !== null && RIG_STATES.indexOf(reached as (typeof RIG_STATES)[number]) >= i;
        return (
          <li
            key={state}
            className={`commit-lamps__item${lit ? ' is-lit' : ''}`}
            data-state={state}
            aria-current={lit ? 'step' : undefined}
          >
            <svg viewBox="0 0 48 48" className="commit-lamps__mark" aria-hidden="true">
              <use href={`#commit-shape-${meta.key}`} />
            </svg>
            <span className="commit-lamps__label">{meta.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One symbol per state, referenced above. Defined once and reused so the four
 * marks are guaranteed to be the same weight and optical size.
 */
export function CommitLampShapes() {
  return (
    <svg style={{ display: 'none' }} aria-hidden="true">
      <symbol id="commit-shape-proposed" viewBox="0 0 48 48">
        <rect x="11" y="11" width="26" height="26" rx="3" />
      </symbol>
      <symbol id="commit-shape-voted" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="14" />
      </symbol>
      <symbol id="commit-shape-finalized" viewBox="0 0 48 48">
        <path d="M24 9 L39 37 H9 Z" strokeLinejoin="round" />
      </symbol>
      <symbol id="commit-shape-verified" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="13" fill="none" strokeWidth="6" />
      </symbol>
    </svg>
  );
}