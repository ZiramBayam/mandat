/**
 * The bridge between things that produce numbers and things that draw them.
 *
 * ## The problem this exists to solve
 *
 * Monad testnet produces a block every ~0.31 seconds, so the commit feed delivers
 * roughly 194 heads per minute to the browser. Scroll events arrive at the same
 * order of magnitude. If either of those called `setState`, React would re-render
 * three or more times a second, forever, on a page that is also running WebGL.
 *
 * That is not a slow page, it is a page that cannot hold 60fps, and it degrades
 * worse as the page grows.
 *
 * ## The shape of the fix
 *
 * External producers -- GSAP, the socket, pointer handlers -- write plain numbers
 * into this object. The render loop reads them every frame and moves real camera
 * and material properties toward them. Nothing here is React state, so nothing
 * here causes a render.
 *
 *     ScrollTrigger ──scrub──► master timeline
 *              │                    │ tweens
 *              │                    ├─► rig.lamps[i]
 *              │                    ├─► rig.progress
 *              │                    └─► rig.pointer.x
 *              ▼
 *           rig (this file: plain mutable object)
 *              │ read every frame
 *              ▼
 *        useFrame ──damp──► real lights, materials, camera
 *
 * ## Why damping is applied twice
 *
 * GSAP's scrub already interpolates between keyframes. Damping on top of that is
 * what makes a fast scroll fling feel fluid instead of teleporting: the target
 * moves in jumps, and the damped value catches up over a few frames. Because
 * `THREE.MathUtils.damp` uses the frame delta, the result is identical at 30fps
 * and 144fps.
 *
 * There is deliberately no React import in this file. If one appears, the pattern
 * has been broken somewhere.
 */

import type { CommitState } from '@mandat/protocol';

/** The four commit states, in the order Monad publishes them. */
export const COMMIT_STATES = ['Proposed', 'Voted', 'Finalized', 'Verified'] as const;

export function commitIndex(state: CommitState): number {
  const i = COMMIT_STATES.indexOf(state);
  // An unrecognised state is treated as the earliest, not the latest. Guessing
  // "must be Verified" would let an unrecognised value release a resource.
  return i === -1 ? 0 : i;
}

export type Lamp = {
  /** 0 = dark, 1 = fully lit. Damped toward by the render loop. */
  target: number;
  /** Smoothed value actually used for rendering. Written by the render loop. */
  value: number;
};

export type Rig = {
  lamps: Lamp[];
  /** Scroll progress across the whole page, 0..1. */
  progress: number;
  /** Normalised pointer, -1..1 on both axes. */
  pointer: { x: number; y: number };
  /**
   * Socket connectivity.
   *
   * Not a React value on purpose, but the render loop reads it every frame and
   * the lamps go dark when it is false -- the same fail-closed rule the seller
   * applies, where an unknown state withholds rather than releasing.
   */
  connected: boolean;
  /** True once at least one head has been seen. */
  started: boolean;
  /** Heads observed since load. For the HUD only; not per-frame. */
  heads: number;
  /** Latest block number seen. */
  head: number;
};

function freshRig(): Rig {
  return {
    lamps: COMMIT_STATES.map(() => ({ target: 0, value: 0 })),
    progress: 0,
    pointer: { x: 0, y: 0 },
    connected: false,
    started: false,
    heads: 0,
    head: 0,
  };
}

export const rig: Rig = freshRig();

/**
 * Reset between scenes.
 *
 * Called on unmount so a scene entered halfway through does not inherit lamps
 * that the previous one lit. Without this, leaving scene 4 and returning to
 * scene 1 would show scene 1 with everything already on.
 */
export function resetRig(): void {
  const fresh = freshRig();
  rig.lamps = fresh.lamps;
  rig.progress = 0;
  rig.pointer.x = 0;
  rig.pointer.y = 0;
  rig.connected = false;
  rig.started = false;
  rig.heads = 0;
  rig.head = 0;
}

/** Light every lamp up to and including `state`, darken the rest. */
export function setReached(state: CommitState): void {
  const reached = commitIndex(state);
  for (const [i, lamp] of rig.lamps.entries()) {
    lamp.target = i <= reached ? 1 : 0;
  }
}

/** All lamps off. Used when the socket drops: unknown withholds. */
export function clearLamps(): void {
  for (const lamp of rig.lamps) lamp.target = 0;
}

export function noteHead(blockNumber: number): void {
  rig.started = true;
  rig.heads += 1;
  rig.head = blockNumber;
}