'use client';

/**
 * Scene 4 -- finality.
 *
 * The horizontal scroll and the arrow stickers come from the credited site. The
 * words are ours and they are the four commit states, because that sequence is
 * the spine of the system: nothing an agent acts on skips a step in it.
 *
 * The lamps below the words are still ours -- a WebSocket subscription on
 * monadNewHeads feeding four R3F bulbs, with a text fallback for when WebGL is
 * unavailable. Nothing in this section is mocked; if the socket is down the
 * page says so rather than showing a reassuring animation.
 */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import dynamic from 'next/dynamic';
import { useEffect, useRef } from 'react';
import { useCommitFeed } from '@/lib/chain';
import { COMMIT_STATES } from '@/lib/motion/rig';
import { FINALITY } from '@/lib/content';

gsap.registerPlugin(ScrollTrigger);

const CommitLamps = dynamic(() => import('@/lib/motion/CommitLamps').then((m) => m.CommitLamps), {
    ssr: false,
    loading: () => <div className="commit-lamps is-loading" />,
});

export default function FinalitySection() {
    const feed = useCommitFeed();
    const sectionRef = useRef(null);

    useEffect(() => {
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
            const pinnedDistance = 2500;

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
                .fromTo(textRef, { x: window.innerWidth }, { x: window.innerWidth * 0.5, ease: 'none', duration: entranceDistance })
                .to(textRef, { x: 0, ease: 'none', duration: pinnedDistance })
                .to(letters, { yPercent: -100, stagger: 0.02, ease: 'none', duration: pinnedDistance }, '<')
                .fromTo(stickers, { y: 0, opacity: 1 }, { y: -30, opacity: 0, stagger: 0.05, duration: 0.6, ease: 'power2.out' }, 0)
                .fromTo(arrows, { strokeDashoffset: 1000 }, { strokeDashoffset: 0, duration: 1.5, ease: 'power2.out' }, 0);
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    const reached = feed.lastCommitState;

    return (
        <section ref={sectionRef} className="horizontal-words-section content-section" id="finality">
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

                <h2 className="display horizontal-words__h2" aria-label="Proposed voted finalized verified">
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

            <div className="card card-wide lamps-card">
                <div className="lamps-head">
                    <h3>{FINALITY.lampsLabel}</h3>
                    <p className={feed.connected ? 'feed-status is-live' : 'feed-status is-down'}>
                        {feed.connected ? 'subscribed to monadNewHeads' : 'not connected'}
                    </p>
                </div>
                <p className="lamps-blurb">{FINALITY.lampsBlurb}</p>

                <CommitLamps reached={reached} connected={feed.connected} />

                <ol className="commit-lamps-fallback">
                    {COMMIT_STATES.map((state, i) => {
                        const lit = feed.connected && reached !== null && COMMIT_STATES.indexOf(reached) >= i;
                        return (
                            <li key={state} className={lit ? 'is-lit' : ''} data-state={state}>
                                <span className="lamp-dot" aria-hidden="true" />
                                <span className="lamp-name">{state}</span>
                                <span className="lamp-status">
                                    {!feed.connected ? 'unknown' : lit ? 'reached' : 'pending'}
                                </span>
                            </li>
                        );
                    })}
                </ol>

                <dl className="feed-facts">
                    <div>
                        <dt>heads</dt>
                        <dd>{feed.heads.toString()}</dd>
                    </div>
                    <div>
                        <dt>final floor</dt>
                        <dd>{feed.finalFloor.toString()}</dd>
                    </div>
                    <div>
                        <dt>last state</dt>
                        <dd>{reached ?? 'unknown'}</dd>
                    </div>
                </dl>
            </div>
        </section>
    );
}