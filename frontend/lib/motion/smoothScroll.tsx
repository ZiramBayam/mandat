'use client';

/**
 * Lenis + GSAP, wired the way they have to be.
 *
 * The three lines in `syncScroll()` are not interchangeable and omitting any one
 * of them causes a bug that is tedious to trace later:
 *
 *   lenis.on('scroll', ScrollTrigger.update)
 *       Without this, ScrollTrigger keeps using the native scroll position while
 *       Lenis has already moved the content. Every pinned section and scrubbed
 *       animation then lags by the smoothing amount, which looks like the page is
 *       drifting out of sync with its own animations.
 *
 *   gsap.ticker.add((time) => lenis.raf(time * 1000))
 *       One animation loop, not two. Lenis and ScrollTrigger each keep their own
 *       rAF by default; running both means the scroll position advances twice per
 *       frame with different timings, and the result jitters at low frame rates.
 *       GSAP's ticker is the single clock, and Lenis is driven from it.
 *
 *   gsap.ticker.lagSmoothing(0)
 *       GSAP by default assumes 60fps and "catches up" after a slow frame by
 *       jumping animations forward. With a live socket and WebGL on the same page
 *       there will be slow frames, and the catch-up makes the scroll visibly snap.
 *
 * Everything is torn down on unmount. React StrictMode double-invokes effects in
 * development, and without cleanup that leaves two Lenis instances fighting over
 * one scroll position.
 */

import React, { useEffect, type ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

/**
 * The live Lenis instance, or undefined before it starts.
 *
 * Exposed because `scroll-behavior: smooth` cannot be used to jump to a section
 * on this page. Lenis is driving the scroll position, so a native smooth scroll
 * runs alongside it and the two disagree: the browser animates to a target the
 * scroller is already moving away from, and the landing point is wrong by
 * however much Lenis travelled in the meantime. Anything that wants to move the
 * page -- the section nav in the header, for instance -- has to go through
 * Lenis so there is one scroller and one clock.
 */
let instance: Lenis | undefined;

export function getLenis(): Lenis | undefined {
  return instance;
}

export function ScrollTo({ target, className, children, ...rest }: { target: string; className?: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const lenis = getLenis();
    const el = document.querySelector(target);
    if (!el) return;
    if (lenis) lenis.scrollTo(el as HTMLElement, { offset: -90 });
    else el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <a href={target} className={className} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}

export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Honour the OS setting at the top level. When reduced motion is requested we
    // do not smooth scroll and do not attach ScrollTrigger; the page renders as
    // plain, ordinary, immediately-scrollable content. Reducing the animation
    // rather than removing it is not sufficient -- for some users the scroll
    // hijacking itself is the problem.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    instance = lenis;
    // The scribble transition reaches for this directly. Kept as well because
    // it is a one-line contract that is easy to break by renaming the module.
    (window as unknown as { __lenis?: Lenis }).__lenis = lenis;

    const onScroll = () => ScrollTrigger.update();
    lenis.on('scroll', onScroll);

    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      lenis.off('scroll', onScroll);
      lenis.destroy();
      instance = undefined;
      delete (window as unknown as { __lenis?: Lenis }).__lenis;
    };
  }, []);

  return <>{children}</>;
}