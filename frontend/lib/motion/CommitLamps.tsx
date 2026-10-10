'use client';

/**
 * The Four Lights.
 *
 * Monad's `monadNewHeads` feed reports a `commitState` on every block, and there
 * are FOUR of them: Proposed, Voted, Finalized, Verified. That fourth state is
 * real and this component does not hide it. A three-lamp display would be
 * simpler and wrong.
 *
 * ## Why 3D, and why only here
 *
 * Four state transitions read better as something physical than as four styled
 * boxes: dark glass, filament lit, glow steady. That is what this component is
 * for, and it is the reason the package is called Three-Light. Elsewhere on the
 * page, 3D would be decoration; here it carries the claim.
 *
 * ## The performance rules
 *
 * - The rig is read in `useFrame`, never through React state. Reading it through
 *   state would re-render React per feed event, and the feed fires ~194 times a
 *   minute.
 * - Damping is frame-rate independent (`MathUtils.damp`), so motion looks the same
 *   at 30fps and 144fps.
 * - `dpr` is capped at 1.5. Under glass and emissive glow the difference is not
 *   visible and it halves the fill cost.
 * - The render loop is suspended when the canvas scrolls out of view. A lamp field
 *   nobody can see should not be spending GPU.
 * - No post-processing pass. Bloom is the expensive part of the effect and the
 *   emissive materials plus a point light carry it adequately.
 *
 * ## Fail-closed
 *
 * When the socket drops, every lamp goes dark. Not "stays at the last value" --
 * that would read as finalized, which is the precise failure this product exists
 * to prevent. The seller in `@mandat/authority-header` withholds on unknown for
 * the same reason.
 */

import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * R3F v8 augments the top-level `JSX` namespace, but React 19 moved intrinsic
 * elements to `React.JSX`. The two do not meet, so every three.js element in
 * this file -- mesh, group, pointLight -- is a type error until the shapes are
 * re-exported onto the namespace React 19 actually reads.
 *
 * Written out rather than imported because there is nothing to import: fiber's
 * own `declare global` targets the old namespace.
 */
import type { ThreeElements } from '@react-three/fiber';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
import { COMMIT_STATES, clearLamps, rig, setReached } from './rig.js';

const DIM = new THREE.Color('#1b2430');
const LIT: readonly string[] = ['#4a5568', '#8a6d1f', '#1f6f4a', '#2b7fd4'];

function Bulb({ index }: { index: number }) {
  const group = useRef<THREE.Group>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const color = useRef(new THREE.Color(DIM));

  useFrame((_, delta) => {
    const lamp = rig.lamps[index];
    if (lamp === undefined || material.current === null || group.current === null) return;

    // Damped toward the target the socket wrote. Not snapped: the approach to
    // "lit" is the readable part.
    lamp.value = THREE.MathUtils.damp(lamp.value, lamp.target, 6, delta);

    const lit = Math.min(1, Math.max(0, lamp.value));
    color.current.lerpColors(DIM, new THREE.Color(LIT[index] ?? LIT[0]), lit);
    material.current.color.copy(color.current);
    material.current.emissive.copy(color.current);
    material.current.emissiveIntensity = lit * 1.4;

    // Unlit lamps sit back; lit ones come forward slightly. The depth change is
    // what makes it read as a physical filament rather than a coloured dot.
    group.current.position.y = THREE.MathUtils.damp(group.current.position.y, lit * 0.12, 6, delta);
  });

  return (
    <group ref={group} position={[0, 0, 0]}>
      <mesh>
        {/* Not a bare sphere: the glass is taller than it is wide, which reads as a
            bulb rather than a dot, and gives the glow something to wrap. */}
        <capsuleGeometry args={[0.34, 0.5, 8, 24]} />
        <meshStandardMaterial ref={material} roughness={0.25} metalness={0.05} />
      </mesh>
      <mesh position={[0, -0.55, 0]}>
        <cylinderGeometry args={[0.12, 0.16, 0.22, 16]} />
        <meshStandardMaterial color="#0d1117" roughness={0.6} metalness={0.4} />
      </mesh>
    </group>
  );
}

function Lamps() {
  return (
    <>
      {COMMIT_STATES.map((state, i) => (
        <group key={state} position={[(i - 1.5) * 1.15, 0, 0]}>
          <Bulb index={i} />
        </group>
      ))}
      <ambientLight intensity={0.35} />
      {/* One point light in front, so the glass picks up a highlight and the row
          reads as four objects in a space rather than four flat discs. */}
      <pointLight position={[0, 1.4, 2.4]} intensity={9} distance={9} color="#9fb4d0" />
    </>
  );
}

/**
 * Drive the rig from the feed.
 *
 * `setReached` walks the lamps up to the observed state, so the display shows
 * "this is how far the chain got" rather than "this is the current block", which
 * flickers between Proposed and Voted on nearly every head.
 */
function useFeedIntoRig(reached: string | null, connected: boolean) {
  useEffect(() => {
    if (!connected) {
      // Fail-closed. Dark, not frozen.
      clearLamps();
      return;
    }
    if (reached !== null) setReached(reached as Parameters<typeof setReached>[0]);
  }, [reached, connected]);
}

export function CommitLamps({ reached, connected }: { reached: string | null; connected: boolean }) {
  useFeedIntoRig(reached, connected);

  const [visible, setVisible] = useState(true);
  const host = useRef<HTMLDivElement>(null);

  // Stop rendering entirely when scrolled away. frameloop="demand" plus this
  // means zero GPU cost off-screen, which is most of the scroll.
  useEffect(() => {
    const el = host.current;
    if (el === null || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { threshold: 0.05 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [webgl, setWebgl] = useState(true);
  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const ok = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
      setWebgl(ok);
    } catch {
      setWebgl(false);
    }
  }, []);

  if (!webgl) return <LampsFallback reached={reached} connected={connected} />;

  return (
    <div ref={host} className="commit-lamps" aria-hidden="true">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.6, 4.2], fov: 42 }}
        frameloop={visible ? 'always' : 'never'}
        gl={{ antialias: true, alpha: true }}
      >
        <Lamps />
      </Canvas>
    </div>
  );
}

/**
 * The same four states without WebGL.
 *
 * Not a nicety: the states are the evidence, so they have to survive a machine
 * with no GPU, a blocklist, or a browser that refuses the context. Each is
 * distinguished by fill as well as hue, because a distinction carried only by
 * colour is not a distinction for everyone.
 */
export function LampsFallback({ reached, connected }: { reached: string | null; connected: boolean }) {
  return (
    <ol className="commit-lamps-fallback">
      {COMMIT_STATES.map((state, i) => {
        const lit = connected && reached !== null && COMMIT_STATES.indexOf(reached as never) >= i;
        return (
          <li key={state} className={lit ? 'is-lit' : ''} data-state={state}>
            <span className="lamp-dot" aria-hidden="true" />
            <span className="lamp-name">{state}</span>
            <span className="lamp-status">{connected ? (lit ? 'reached' : 'pending') : 'unknown'}</span>
          </li>
        );
      })}
    </ol>
  );
}