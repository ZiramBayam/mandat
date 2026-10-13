'use client';

/**
 * The scribble transition.
 *
 * Clicking the wordmark writes "mandat" across the page in script, then wipes
 * it away and returns to the top. That is the whole effect, and it is the one
 * piece of the source site's choreography worth keeping.
 *
 * The artwork is not theirs. The original was a single vector path -- the source
 * company's cursive wordmark -- sitting behind a fixed, full-viewport element at
 * z-index 9999, which meant their logo was painted over every section of the
 * page. Renaming the element did not change the shape of the letters, and the
 * inline `strokeWidth: 0` that was meant to hide it was being overridden by the
 * stylesheet.
 *
 * So the name is drawn as real text in Satisfy (SIL OFL), which also fixes the
 * accessibility problem a path cannot: this is selectable and announced.
 *
 * The draw-on animation is rebuilt for text. The original measured the artwork
 * with `getTotalLength()` to size its stroke dash; a <text> node has no such
 * method. Instead two copies are drawn -- one stroked and hollow, which writes
 * itself on, and one filled, which fades up underneath as the stroke completes.
 * The dash length is a constant sized for the word at its rendered size.
 */

import { useEffect } from 'react';
import { gsap } from 'gsap';
import { ANIMATION_CONFIG } from '@/lib/data';

/**
 * Width the reveal is animated across, in viewBox units. Matches the viewBox
 * below, so the word is guaranteed to be revealed in full.
 *
 * This started out as a stroke-dash draw, which cannot work here: dash lengths
 * have to match the outline's total length, and a <text> node has no
 * getTotalLength(). The advance width is measurable but the perimeter is not,
 * so any constant is a guess -- and a guess that is too short reveals the tail
 * of the word all at once instead of writing it. A mask that wipes across the
 * whole box has no such failure mode.
 */
const REVEAL_WIDTH = 1200;

/** Beat between the word landing and it being erased, when there is a veil. */
const HOLD = 0.3;

/** How long the veil takes to clear the screen. */
const RECEDE = 1.0;

export default function TransitionScribble() {
    useEffect(() => {
        const trigger = document.querySelector('.nav-brand');
        const strokeLayer = document.querySelector('.transition-scribble .scribble__stroke');
        const fillLayer = document.querySelector('.transition-scribble .scribble__fill');
        const wipe = document.querySelector('.transition-scribble .scribble__wipe');
        const scribble = document.querySelector('.transition-scribble');
        const veil = document.querySelector('.transition-veil');

        if (!trigger || !strokeLayer || !fillLayer || !wipe || !scribble) return;

        let failsafe = null;

        const transitionColors = [
            'var(--color-green)', 'var(--color-lightblue)', 'var(--color-darkblue)',
            'var(--color-lightgreen)', 'var(--color-orange)', 'var(--color-maroon)', 'var(--color-pink)',
        ];

        const runScribbleAnimation = (e) => {
            if (e) e.preventDefault();
            if (
                gsap.isTweening(wipe) ||
                gsap.isTweening(scribble) ||
                document.body.classList.contains('is-transitioning')
            ) {
                return;
            }

            const config = ANIMATION_CONFIG.transitionScribble;
            const durIn = config.durationIn || 0.8;
            const durOut = config.durationOut || 1.5;
            const randomColor = transitionColors[Math.floor(Math.random() * transitionColors.length)];

            // The veil belongs to the arrival only. Clicking the wordmark in the
            // navbar replays the drawing over the page, and blanking the screen
            // on every click turns a flourish into an interruption.
            const isIntro = !e;

            scribble.style.color = randomColor;

            const mark = document.querySelector('.transition-mark');
            if (mark) {
                mark.style.color = randomColor;
                mark.classList.add('is-active');
            }

            gsap.set(scribble, { scale: config.scale, autoAlpha: 1 });
            gsap.set(wipe, { attr: { x: 0, width: 0 } });
            gsap.set(fillLayer, { opacity: 0, y: 10 });
            if (isIntro && veil) {
                gsap.set(veil, { scaleY: 1, display: 'block', transformOrigin: 'top center' });
            }

            document.body.classList.add('is-transitioning');
            const cursorBubble = document.querySelector('.cursor-bubble');
            if (cursorBubble) gsap.to(cursorBubble, { opacity: 0, duration: 0.2 });

            const tl = gsap.timeline({
                onComplete: () => {
                    document.body.classList.remove('is-transitioning');
                    gsap.set([strokeLayer, fillLayer], { opacity: 0 });
                    gsap.set(wipe, { attr: { x: 0, width: 0 } });
                    gsap.set(scribble, { autoAlpha: 0 });
                    if (veil) gsap.set(veil, { display: 'none' });
                    if (mark) mark.classList.remove('is-active');
                },
            });

            // Write the word on.
            tl.to(wipe, { attr: { width: REVEAL_WIDTH }, duration: durIn, ease: 'power1.inOut' }, 0);
            // The solid copy rises underneath as the reveal lands, so the word
            // ends up filled rather than left as an outline.
            tl.to(fillLayer, { opacity: 1, y: 0, duration: durIn * 0.4, ease: 'power2.out' }, durIn * 0.68);

            // Back to the top, as though the page had just been re-entered.
            tl.call(() => {
                const lenis = window.__lenis;
                if (lenis) lenis.scrollTo(0, { immediate: true });
                else window.scrollTo(0, 0);
            }, null, durIn);

            // Erase it. The source does this by running the stroke's dash past
            // the end of its own path (strokeDashoffset from 0 to -len) while
            // the stroke thins back down, so the line un-draws itself from the
            // start. A <text> node has no getTotalLength(), which is why this
            // site already clips instead. The equivalent is to start the clip
            // rect on the far side of the word and walk it out to the right,
            // rather than running its width back down to zero -- same motion,
            // no dash length to guess.
            const eraseAt = durIn + (isIntro ? HOLD : 0);
            tl.set(wipe, { attr: { x: REVEAL_WIDTH, width: REVEAL_WIDTH } }, eraseAt);
            tl.to(wipe, { attr: { width: 0 }, duration: durOut, ease: 'power2.inOut' }, eraseAt);
            // The fill lets go a little ahead of the stroke, so what is left
            // being erased is an outline rather than a solid shape shrinking.
            tl.to(fillLayer, { opacity: 0, duration: durOut * 0.45, ease: 'power2.in' }, eraseAt);

            if (isIntro && veil) {
                // The word is gone by now, so only the flat colour is left, and
                // it clears from the bottom upwards. transform-origin is top, so
                // the veil collapses toward its own top edge and the page is
                // uncovered starting from the bottom of the screen.
                const recedeAt = eraseAt + durOut;
                tl.call(
                    () => {
                        window.dispatchEvent(new CustomEvent('mandat:reveal'));
                    },
                    null,
                    recedeAt,
                );
                tl.to(veil, { scaleY: 0, duration: RECEDE, ease: 'power2.inOut' }, recedeAt);
            }

            return () => {
                document.body.classList.remove('is-transitioning');
                gsap.killTweensOf([strokeLayer, fillLayer, scribble, wipe]);
                if (veil) gsap.set(veil, { display: 'none' });
            };
        };

        trigger.addEventListener('click', runScribbleAnimation);

        // Reduced motion gets no veil and no drawing. An opaque overlay for four
        // seconds is exactly the thing that setting asks not to happen.
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            if (veil) gsap.set(veil, { display: 'none' });
        } else {
            // Play once on arrival, but not on a timer. At 100ms the font had
            // often not loaded, so the word rendered in the fallback and the
            // whole animation was spent on text nobody was reading yet. Waiting
            // for the face, then pausing a beat, puts it somewhere it can
            // actually be seen.
            let started = false;
            const play = () => {
                if (started) return;
                started = true;
                runScribbleAnimation(null);
            };
            const fonts = document.fonts;
            const ready = fonts?.ready ? fonts.ready : Promise.resolve();
            ready
                .then(() => new Promise((r) => setTimeout(r, 600)))
                .then(play)
                .catch(play);

            // Nothing may leave the veil on screen. If the font promise never
            // settles, or the effect is torn down mid-run, the page would be
            // covered with no way back.
            failsafe = setTimeout(() => {
                if (veil) gsap.set(veil, { display: 'none' });
                window.dispatchEvent(new CustomEvent('mandat:reveal'));
            }, 8000);
        }

        return () => {
            trigger.removeEventListener('click', runScribbleAnimation);
            clearTimeout(failsafe);
        };
    }, []);

    return (
        <>
            {/* Flat cover for the arrival. Hidden again once the reveal has run,
                and display:none from the very start under reduced motion, so it
                can never sit on top of the page. */}
            <div className="transition-veil" aria-hidden="true" />

            <svg
                xmlns="http://www.w3.org/2000/svg"
                className="transition-scribble"
                viewBox="0 0 1200 480"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
                focusable="false"
            >
                {/* The reveal. Widening this rect left to right is what makes the
                    word appear to be written; parking it on the far side and
                    walking it out to the right is what erases it. */}
                <defs>
                <clipPath id="scribble-reveal">
                    <rect className="scribble__wipe" x="0" y="0" width="0" height="480" />
                </clipPath>
            </defs>

            {/* Hollow and stroked: this is the one that writes itself on. */}
            <text
                className="scribble__stroke"
                x="600"
                y="320"
                clipPath="url(#scribble-reveal)"
                textAnchor="middle"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                mandat
            </text>
            {/* Filled: fades in behind the stroke as it completes. */}
            <text className="scribble__fill" x="600" y="320" textAnchor="middle" fill="currentColor">
                mandat
                </text>
            </svg>
        </>
    );
}