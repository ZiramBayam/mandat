'use client';

/**
 * Scene 3 -- the agent.
 *
 * The two scrolling columns and the blob come from the credited site. The items
 * in the columns are this repository's own packages and contracts, listed
 * instead of client logos: the section is supposed to say what is actually
 * built, and a row of borrowed brand marks would have said something else.
 */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useState } from 'react';
import { AGENT } from '@/lib/content';

gsap.registerPlugin(ScrollTrigger);

const TONE = {
    green: 'var(--color-green)',
    lightblue: 'var(--color-lightblue)',
    orange: 'var(--color-orange)',
    pink: 'var(--color-pink)',
    maroon: 'var(--color-maroon)',
    darkblue: 'var(--color-darkblue)',
    lightgreen: 'var(--color-lightgreen)',
};

export default function AgentSection() {
    const [looped, setLooped] = useState(AGENT.columns);

    useEffect(() => {
        // The track is duplicated once so the loop has no seam. On mobile the
        // rows are already narrower than the viewport, so a second copy just
        // makes the user scroll twice as far for nothing.
        if (window.matchMedia('(max-width: 768px)').matches) return;
        setLooped(AGENT.columns.map((col) => [...col, ...col]));
    }, []);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.set('.marquee-left .marquee-svg-item:nth-child(2) path', { strokeDashoffset: 1000 });

            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: '.Double-marquee',
                    start: 'top 70%',
                    toggleActions: 'play none none reverse',
                },
            });

            tl.to('.marquee-underline', { scaleX: 1, opacity: 1, duration: 1, ease: 'power2.out' })
                .to(
                    '.marquee-left .marquee-svg-item:nth-child(1)',
                    { scale: 1, opacity: 1, rotation: -10, duration: 0.6, ease: 'back.out(1.7)' },
                    '-=0.5',
                )
                .to(
                    '.marquee-left .marquee-svg-item:nth-child(2) path',
                    { strokeDashoffset: 0, duration: 1.5, ease: 'power2.out' },
                    '-=0.3',
                );
        });
        return () => ctx.revert();
    }, []);

    return (
        <section className="Double-marquee" id="agent">
            <div className="marquee-left">
                <div className="marquee-text-container">
                    <h2>
                        {AGENT.title[0]}
                        <br />
                        {AGENT.title[1]}
                        <span className="text-with">.</span>
                    </h2>
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="marquee-underline"
                        viewBox="0 0 132 5"
                        fill="none"
                    >
                        <path
                            d="M1 2.08377C44.3458 3.90451 87.9791 5.71442 131 1"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </div>

                <div className="marquee-blob-container">
                    <img src="/assets/Marquee-blob SVG/marquee-blob.svg" className="marquee-blob" alt="" aria-hidden="true" />
                    <div className="marquee-svg-container">
                        <div className="marquee-svg-item">
                            <img src="/assets/Marquee-blob SVG/marquee-hand.svg" width="100%" alt="" aria-hidden="true" />
                        </div>
                        <div className="marquee-svg-item">
                            <svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 386 127" fill="none">
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
                        </div>
                    </div>
                </div>
            </div>

            <div className="marquee-right">
                {looped.map((track, col) => (
                    <div key={col} className="marquee-column">
                        <div className="marquee-track">
                            {track.map((item) => (
                                <div
                                    key={`${col}-${item.name}`}
                                    className="marquee-item"
                                    data-brand={item.name}
                                    style={{ backgroundColor: TONE[item.tone] ?? 'var(--color-green)' }}
                                >
                                    <div className="marquee-logo marquee-logo--text">
                                        <span>{item.name}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

        </section>
    );
}