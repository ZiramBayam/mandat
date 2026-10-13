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
 * How long the section stays pinned, in pixels.
 *
 * This is the only thing left of a runway element that used to sit here. The
 * runway was 1400px of empty document height added below the section so the pin
 * would have somewhere to pin to, back when this section was the last thing on
 * the page. It is not the last thing any more, and ScrollTrigger's own
 * pinSpacing supplies exactly the height the pin needs -- which is what the
 * source relies on, having no runway of its own.
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

            const entranceDistance = window.innerHeight;
            const pinnedDistance = RUNWAY;

            /* Ported from the source's HorizontalWords.
               The timeline starts at 'top bottom' -- when the section is still
               below the fold -- while the pin starts at 'top top'. Keeping them
               on one trigger made the sweep already half over by the time the
               section reached the top, which is what made it feel like it
               stalled. The source separates them for exactly this reason. */
            const scrollTween = gsap.timeline({
                scrollTrigger: {
                    trigger: container,
                    start: 'top bottom',
                    end: () => `+=${entranceDistance + pinnedDistance}`,
                    scrub: 1,
                    invalidateOnRefresh: true,
                },
            });

            scrollTween
                .fromTo(textRef, {
                    x: window.innerWidth,
                }, {
                    x: window.innerWidth * 0.5,
                    ease: 'none',
                    duration: entranceDistance,
                })
                .to(textRef, {
                    x: () => -(textRef.scrollWidth - window.innerWidth * 0.5),
                    ease: 'none',
                    duration: pinnedDistance,
                });

            // Pin on its own, so it locks only once the section reaches the top.
            ScrollTrigger.create({
                trigger: container,
                start: 'top top',
                end: () => `+=${pinnedDistance}`,
                pin: true,
                pinSpacing: true,
                invalidateOnRefresh: true,
            });

            /* Each letter gets its own trigger bound to the parent timeline, so
               it settles as the text reaches the middle. This is the effect the
               section is for: letters arrive scattered and elastic.out into a
               sentence. The previous version had no per-letter animation at all,
               only a yPercent tween that flew them away again -- the opposite. */
            letters.forEach((letter) => {
                gsap.from(letter, {
                    yPercent: (Math.random() - 0.5) * 500,
                    rotation: (Math.random() - 0.5) * 60,
                    ease: 'elastic.out(1.2, 1)',
                    scrollTrigger: {
                        trigger: letter,
                        containerAnimation: scrollTween,
                        start: 'left 90%',
                        end: 'left 50%',
                        scrub: 0.5,
                    },
                });
            });

            stickers.forEach((sticker) => {
                gsap.from(sticker, {
                    scale: 0,
                    yPercent: (Math.random() - 0.5) * 400,
                    rotation: (Math.random() - 0.5) * 60,
                    ease: 'elastic.out(1.2, 1)',
                    scrollTrigger: {
                        trigger: sticker,
                        containerAnimation: scrollTween,
                        start: 'left 90%',
                        end: 'left 50%',
                        scrub: 0.5,
                    },
                });
            });

            arrows.forEach((arrowPath) => {
                if (arrowPath.getTotalLength) {
                    const pathLen = arrowPath.getTotalLength();
                    gsap.set(arrowPath, { strokeDasharray: pathLen, strokeDashoffset: pathLen });
                    gsap.to(arrowPath, {
                        strokeDashoffset: 0,
                        duration: 1,
                        scrollTrigger: {
                            trigger: arrowPath.parentElement,
                            containerAnimation: scrollTween,
                            start: 'left 90%',
                            end: 'left 50%',
                            scrub: 0.5,
                        },
                    });
                }
            });
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
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
                        src="/assets/HorizontalWords SVG/horizontal-words-sticker-thumps-up.svg"
                        className="horizontal-words__sticker-watch"
                        alt=""
                        aria-hidden="true"
                    />
                    <img
                        src="/assets/HorizontalWords SVG/horizontal-words-sticker-cursor.svg"
                        className="horizontal-words__sticker-cursor"
                        alt=""
                        aria-hidden="true"
                    />
                    <img
                        src="/assets/HorizontalWords SVG/horizontal-words-sticker-phone.svg"
                        className="horizontal-words__sticker-phone"
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
    );
}