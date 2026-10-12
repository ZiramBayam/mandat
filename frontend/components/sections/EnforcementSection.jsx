'use client';

/**
 * Scene 2 -- what the contract refuses.
 *
 * The fan-out on hover is the source site's behaviour, taken whole. Hovering a
 * card pulls it forward and straightens it, and pushes the cards on either side
 * away into a rotated cluster, as if the deck were being dealt around the one
 * under the pointer. Leaving returns everything with the same elastic settle.
 *
 * It is kept because it is the best thing about the source section -- it makes
 * four flat cards feel like objects. What is not kept is the arrangement: there,
 * the cards sat in a hand-placed overlap so that three of four were permanently
 * behind another, which works for photographs and hides text. They are a grid
 * here, so all four can be read before anything is hovered.
 *
 * On a phone the grid stacks and the fan-out is skipped -- the cards have
 * nowhere to fan to, and a hover that cannot happen should not be wired up.
 */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useRef } from 'react';
import { ENFORCEMENT, EVIDENCE } from '@/lib/content';

gsap.registerPlugin(ScrollTrigger);

/** Resting tilt per card, clockwise as the reference had them. */
const REST_ROTATION = [4, -5, 5, -8];

export default function EnforcementSection() {
    const rootRef = useRef(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            const cards = gsap.utils.toArray('.cards-wrapper .card');
            if (cards.length === 0) return;

            // The heading underline. In the source this triggered on
            // ".service-cards-wrapper", a class that exists in no stylesheet --
            // so it never ran, and the underline simply stayed invisible.
            gsap.to('.title-underline-svg path', {
                strokeDashoffset: 0,
                duration: 1.2,
                ease: 'power3.out',
                stagger: 0.3,
                scrollTrigger: { trigger: rootRef.current, start: 'top 70%', toggleActions: 'play none none reverse' },
            });

            if (window.matchMedia('(max-width: 768px)').matches) return;

            cards.forEach((card, index) => {
                const onEnter = () => {
                    const cardWidth = card.offsetWidth;
                    const hoveredLeft = card.offsetLeft;
                    const targetCommonTop = 0;

                    gsap.to(card, {
                        x: 0,
                        y: targetCommonTop - card.offsetTop,
                        rotation: 0,
                        scale: 1.06,
                        zIndex: 20,
                        duration: 0.9,
                        ease: 'elastic.out(1, 0.5)',
                        overwrite: true,
                    });

                    const spread = (others, direction) => {
                        const gap = 18;
                        let cursor = hoveredLeft + direction * (cardWidth + gap);
                        others.forEach((other, i) => {
                            const angle = (REST_ROTATION[other.dataset.cardIndex % REST_ROTATION.length] * Math.PI) / 180;
                            const targetX = cursor - other.offsetLeft;
                            gsap.to(other, {
                                x: targetX,
                                y: targetX * Math.tan(angle),
                                rotation: REST_ROTATION[other.dataset.cardIndex % REST_ROTATION.length],
                                scale: 1,
                                duration: 1.0,
                                ease: 'elastic.out(1, 0.5)',
                                overwrite: true,
                            });
                            cursor += direction * (other.offsetWidth + gap);
                            void i;
                        });
                    };

                    const before = cards.slice(0, index).reverse();
                    const after = cards.slice(index + 1);
                    if (after.length) spread(after, 1);
                    if (before.length) spread(before, -1);
                };

                const onLeave = () => {
                    cards.forEach((c) => {
                        gsap.to(c, {
                            x: 0,
                            y: 0,
                            scale: 1,
                            rotation: REST_ROTATION[c.dataset.cardIndex % REST_ROTATION.length],
                            zIndex: 1,
                            duration: 1.0,
                            ease: 'elastic.out(1, 0.5)',
                            overwrite: true,
                            delay: 0.08,
                        });
                    });
                };

                card.addEventListener('mouseenter', onEnter);
                card.addEventListener('mouseleave', onLeave);
                ctx.add(() => {
                    card.removeEventListener('mouseenter', onEnter);
                    card.removeEventListener('mouseleave', onLeave);
                });
            });
        }, rootRef);

        return () => ctx.revert();
    }, []);

    return (
        <section ref={rootRef} className="enforcement-section" id="enforcement">
            <div className="title-container">
                <h2 className="main-title">
                    {ENFORCEMENT.title} <span className="italic-text">{ENFORCEMENT.titleAccent}</span>
                </h2>
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="160"
                    viewBox="0 0 159 17"
                    fill="none"
                    className="title-underline-svg"
                >
                    <path
                        d="M1 12.1515C53.0771 5.7187 105.529 2.30552 158 1.93652"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    <path
                        d="M30.2672 15.9461C64.1899 12.8158 98.2663 11.3583 132.33 11.5735"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </div>

            <div className="cards-wrapper" id="cards-wrapper">
                {ENFORCEMENT.cards.map((card, i) => (
                    <div key={card.title} className={`card card-${card.color}`} data-card-index={i}>
                        <h3 className="card-title">{card.title}</h3>
                        <svg width="100%" height="10" className="card-divider-svg" aria-hidden="true">
                            <use href="#card-divider" />
                        </svg>
                        <ul className="card-list">
                            {card.items.map((item) => (
                                <li key={item}>
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="13"
                                        height="16"
                                        className="services-card__bullet-svg"
                                        aria-hidden="true"
                                    >
                                        <use href="#bullet-icon" />
                                    </svg>
                                    {item}
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>

            <div className="evidence-strip">
                <a className="evidence-chip evidence-chip--pass" href={EVIDENCE.g6Within.href} target="_blank" rel="noreferrer">
                    <span className="evidence-chip__label">{EVIDENCE.g6Within.label}</span>
                    <span className="evidence-chip__value">{EVIDENCE.g6Within.value}</span>
                </a>
                <a className="evidence-chip evidence-chip--fail" href={EVIDENCE.g6Over.href} target="_blank" rel="noreferrer">
                    <span className="evidence-chip__label">{EVIDENCE.g6Over.label}</span>
                    <span className="evidence-chip__value">{EVIDENCE.g6Over.value}</span>
                </a>
            </div>
        </section>
    );
}