'use client';

/**
 * Scene 4 -- finality.
 *
 * The scrolling words and the arrow stickers come from the credited site. The
 * words are ours, and they are the four states, because that sequence is the
 * spine of the whole thing: nothing an agent acts on skips a step in it.
 *
 * Two things were wrong with how this section was first ported, and both are
 * what made it feel broken:
 *
 * It had no pin. The horizontal move was a scrub on a normal, freely scrolling
 * section, so the page would slide past while the word was still travelling --
 * the word would be half off the right edge with the section already behind
 * you, and no amount of scrolling would bring it back. Pinning holds the
 * section until the sweep finishes.
 *
 * And it made the reader depend on the sweep to learn the states. The four rows
 * below the lamps already list every state and whether it has been reached, so
 * they are now controls: select one and it explains itself in words. The
 * animation is the garnish; the content does not depend on it.
 *
 * The lamps moved out of this section into LiveFeed, into the slot the source
 * site left unfinished.
 */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useRef } from 'react';
import { COMMIT_STATES, FINALITY } from '@/lib/content';

gsap.registerPlugin(ScrollTrigger);

/**
 * How much scroll the pinned sweep is given, and also how tall the runway
 * beneath it is.
 *
 * They have to be the same number for a reason that is not obvious. ScrollTrigger
 * pins by fixing the element and growing a spacer, but it will not grow that
 * spacer past the bottom of the document -- if there is not enough room left to
 * scroll, it silently clamps the pin to zero. With every section exactly one
 * screen tall this section is at the end of the page, so there was never enough
 * runway: the pin reported as configured, left a pin-spacer behind, and did
 * nothing at all. The explicit runway below is what gives it somewhere to go.
 *
 * 1400 rather than the 2500 the source used, for the same reason as before --
 * two and a half thousand pixels of scrubbing is long enough to skim past.
 */
const RUNWAY = 1400;

export default function FinalitySection() {
    const sectionRef = useRef(null);

    useEffect(() => {
        // Under reduced motion there is no Lenis and nothing drives
        // ScrollTrigger, so the sweep below would never run -- and the words
        // would sit at x: innerWidth, off the right edge of the screen, with no
        // way to scroll them back. Someone asking for less motion would be left
        // with an empty page. The section is laid out plainly instead.
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const plain = sectionRef.current;
            if (!plain) return;
            gsap.set(plain.querySelectorAll('.letter'), { yPercent: 0, y: 0 });
            return;
        }

        const ctx = gsap.context(() => {
            const container = sectionRef.current;
            if (!container) return;
            const textRef = container.querySelector('.horizontal-words__relative');
            const letters = container.querySelectorAll('.letter');
            const stickers = container.querySelectorAll(
                '.horizontal-words__sticker-watch, .horizontal-words__sticker-cursor, .horizontal-words__sticker-phone',
            );
            const arrows = container.querySelectorAll(
                '.horizontal-words__arrow-svg path, .horizontal-words__arrow-end-svg path',
            );

            const entranceDistance = window.innerHeight * 0.6;
            const pinnedDistance = RUNWAY;

            const scrollTween = gsap.timeline({
                scrollTrigger: {
                    trigger: container,
                    start: 'top top',
                    end: () => `+=${entranceDistance + pinnedDistance}`,
                    // Hold the section for the whole sweep. Without this the page
                    // simply moves on and the word is left mid-flight.
                    pin: true,
                    anticipatePin: 1,
                    scrub: 1,
                    invalidateOnRefresh: true,
                },
            });

            scrollTween
                .fromTo(textRef, { x: window.innerWidth }, { x: 0, ease: 'none', duration: entranceDistance })
                .to(letters, { yPercent: -100, stagger: 0.02, ease: 'none', duration: pinnedDistance }, '<')
                .fromTo(stickers, { y: 0, opacity: 1 }, { y: -30, opacity: 0, stagger: 0.05, duration: 0.6, ease: 'power2.out' }, 0)
                .fromTo(arrows, { strokeDashoffset: 1000 }, { strokeDashoffset: 0, duration: 1.5, ease: 'power2.out' }, 0);
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <>
        <section ref={sectionRef} className="horizontal-words-section" id="finality">
            <div className="horizontal-words__relative">
                <div className="horizontal-words__sticker-svg">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="100%"
                        viewBox="0 0 386 127"
                        fill="none"
                        className="horizontal-words__arrow-svg"
                    >
                        <path
                            d="M2 123C9 35.9999 84.5 17 124 25.9999C217.764 47.3635 207 115 177.5 123C105.777 142.45 110.737 1.99991 232.5 2C310.5 2.00006 366.5 79 376 118L356.5 105.5"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <path
                            d="M2 123C9 35.9999 84.5 17 124 25.9999C217.764 47.3635 207 115 177.5 123C105.777 142.45 110.737 1.99991 232.5 2C310.5 2.00006 366.5 79 376 118L384 97"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                    <img
                        src="/assets/HorizontalWords SVG/horizontal-words-sticker-thumbs-up.svg"
                        className="horizontal-words__sticker-watch"
                        alt=""
                        aria-hidden="true"
                    />
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="100%"
                        viewBox="0 0 140 127"
                        fill="none"
                        className="horizontal-words__arrow-end-svg"
                    >
                        <path
                            d="M2.03125 2.42188C100.469 2.42188 130.156 52.4219 118.437 125.078L99.6875 107.891"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <path
                            d="M2.03125 2.42188C100.469 2.42188 130.156 52.4219 118.438 125.078L137.969 110.234"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </div>

                <h2 className="display horizontal-words__h2" aria-label={FINALITY.words.join(' ')}>
                    {FINALITY.words.join(' ').split('').map((ch, i) =>
                        ch === ' ' ? (
                            ' '
                        ) : (
                            <div key={i} className="letter" aria-hidden="true" style={{ position: 'relative', display: 'inline-block' }}>
                                {ch}
                            </div>
                        ),
                    )}
                </h2>
            </div>

        </section>

        {/* Scroll runway. Not visible and not styled -- it exists so the pin
            above has somewhere to be pinned to. See RUNWAY. */}
        <div className="finality-runway" style={{ height: RUNWAY }} aria-hidden="true" />
        </>
    );
}