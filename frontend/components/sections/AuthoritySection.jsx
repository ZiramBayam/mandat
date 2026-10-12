'use client';

/**
 * Scene 1 -- the envelope.
 *
 * The section shell, the inertia physics and the class names come from the
 * credited third-party site; the words and the four cards are ours. The cards
 * stand in for the four commit states rather than four stock photographs,
 * because the state machine is the thing this page is actually about.
 */

import gsap from 'gsap';
import { InertiaPlugin } from 'gsap/InertiaPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useRef } from 'react';
import { AUTHORITY, COMMIT_STATES } from '@/lib/content';

gsap.registerPlugin(InertiaPlugin, ScrollTrigger);

export default function AuthoritySection() {
    const sectionRef = useRef(null);

    useEffect(() => {
        // Same reason as the word sweep: without ScrollTrigger the entrance
        // timeline never runs, and the cards would be left at the +160px offset
        // they were parked at, so the section would open on an unexplained gap.
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const ctx = gsap.context(() => {
            // The cards follow the cursor and fling back on leave. Copied from
            // the source site's feel; the numbers are ours because a card that
            // snaps back too slowly stops reading as an object.
            for (const card of document.querySelectorAll('.motion-card__card')) {
                let lastX = 0;
                let lastY = 0;
                let speedX = 0;
                let speedY = 0;
                const startRotation = gsap.getProperty(card, 'rotation');
                const startX = gsap.getProperty(card, 'x');
                const startY = gsap.getProperty(card, 'y');

                const onMove = (e) => {
                    speedX = e.clientX - lastX;
                    speedY = e.clientY - lastY;
                    lastX = e.clientX;
                    lastY = e.clientY;
                };
                const onEnter = (e) => {
                    speedX = 0;
                    speedY = 0;
                    lastX = e.clientX;
                    lastY = e.clientY;
                };
                const onLeave = () => {
                    gsap.to(card, {
                        inertia: {
                            x: { velocity: speedX * 20, end: startX },
                            y: { velocity: speedY * 20, end: startY },
                            rotation: { velocity: speedX * 1.5, end: startRotation },
                        },
                    });
                };

                card.addEventListener('mousemove', onMove);
                card.addEventListener('mouseenter', onEnter);
                card.addEventListener('mouseleave', onLeave);
            }

            for (const label of document.querySelectorAll('.motion-card__floating-label')) {
                let lastX = 0;
                let speedX = 0;
                const startRotation = gsap.getProperty(label, 'rotation');
                const startX = gsap.getProperty(label, 'x');
                const startY = gsap.getProperty(label, 'y');

                const onMove = (e) => {
                    speedX = e.clientX - lastX;
                    lastX = e.clientX;
                };
                const onEnter = (e) => {
                    speedX = 0;
                    lastX = e.clientX;
                };
                const onLeave = () => {
                    gsap.to(label, {
                        inertia: {
                            x: { velocity: speedX * 20, end: startX },
                            y: { end: startY },
                            rotation: { velocity: speedX * 1.5, end: startRotation },
                        },
                    });
                };

                label.addEventListener('mousemove', onMove);
                label.addEventListener('mouseenter', onEnter);
                label.addEventListener('mouseleave', onLeave);
            }

            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: sectionRef.current,
                    start: 'top 70%',
                    toggleActions: 'play none none reverse',
                },
            });

            for (const card of document.querySelectorAll('.motion-card__card')) {
                const from = gsap.getProperty(card, 'y');
                gsap.set(card, { y: from + 160 });
                tl.to(card, { y: from, duration: 1.2, ease: 'power3.out' }, 0.1);
            }

            for (const label of document.querySelectorAll('.motion-card__floating-label')) {
                gsap.set(label, { scale: 0, opacity: 0, rotation: -14 });
                tl.to(label, { scale: 1, opacity: 1, rotation: 0, duration: 0.9, ease: 'back.out(1.7)' }, 0.5);
            }

            const underline = sectionRef.current?.querySelector('.motion-card__underline-path');
            if (underline) {
                const len = underline.getTotalLength();
                gsap.set(underline, { strokeDasharray: len, strokeDashoffset: len });
                tl.to(underline, { strokeDashoffset: 0, duration: 1.5, ease: 'power2.out' }, 0.2);
            }
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="motion-card-section" id="authority">
            <div className="motion-card__heading">
                <h2 className="motion-card__title">
                    {AUTHORITY.title[0]}
                    <br />
                    {AUTHORITY.title[1]}
                </h2>
                <p className="motion-card__subtitle">{AUTHORITY.subtitle}</p>
            </div>

            <div className="motion-card__cards-area">
                <div className="motion-card__cards">
                    {COMMIT_STATES.map((state, i) => (
                        <div key={state.key} className={`motion-card__card motion-card__card--${i + 1}`}>
                            <div className={`motion-card__card-image commit-panel commit-panel--${state.key}`}>
                                <span className="commit-card__marker" aria-hidden="true" />
                                <h3 className="commit-card__title">{state.label}</h3>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="motion-card__floating-labels">
                    {AUTHORITY.labels.map((text, i) => (
                        <div
                            key={text}
                            className={`motion-card__floating-label motion-card__floating-label--${['pink', 'orange', 'red'][i]}`}
                        >
                            <p className="motion-card__floating-text">{text}</p>
                        </div>
                    ))}
                </div>
            </div>

            <div className="motion-card__footer-text">
                <p className="motion-card__description">{AUTHORITY.closing}</p>
            </div>
        </section>
    );
}