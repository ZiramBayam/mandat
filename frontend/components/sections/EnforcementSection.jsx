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
import { ENFORCEMENT } from '@/lib/content';

gsap.registerPlugin(ScrollTrigger);

/**
 * Hover spacing, from the reference (ServiceCards.jsx:126-128, 144, 149).
 *
 * HOVER_GAP is the clear space between the card being pointed at and the first
 * one pushed aside. The reference uses 120px, which over a row this size reads
 * as a hole rather than a separation. At 24px the pushed card clears the front
 * card by a visible margin without the row coming apart.
 *
 * CLUSTER_GAP steps every card after that. The reference uses 150, which is
 * under half a card wide, so the cards that are not hovered overlap each other
 * and stay a fan. At this row's size that read as too much travel: the outermost
 * card landed 740px from the pointed-at one, a 964px spread across a 1326px
 * wrapper. At 40 the spread is 744px, the cards still overlap heavily, and the
 * step stays under a quarter of a card so the cluster never fans out.
 *
 * It cannot go to CARD_WIDTH + gap the way the first one does: four 320px cards
 * with no overlap at all need 4x320 + 3x24 = 1352px, so pointing at the outermost
 * card would push the last one clean off a 1366px screen. The two cards nearest
 * the pointer separate; the ones behind them lean.
 */
const HOVER_GAP = 24;
const CLUSTER_GAP = 40;
const CARD_WIDTH = 320;

/** The hovered card rises here and squares up, whatever its own top was. */
const TARGET_COMMON_TOP = 50;

/**
 * Reads a card's resting tilt out of its stylesheet rotate(), in degrees.
 *
 * The reference hardcodes the same four numbers as `originalData`. Parsing the
 * computed matrix keeps cards.css the single source of truth, and it is also
 * right in the range where the tilt does not exist: between 769px and 1348px the
 * stylesheet resets transform to none, so this returns 0 -- which is exactly
 * what is on screen there, and what the card springs back to.
 *
 * A 2D matrix is [a, b, c, d, e, f] and the rotation is atan2(b, a).
 */
function restingRotation(el) {
    const transform = getComputedStyle(el).transform;
    if (!transform || transform === 'none') return 0;

    const matrix = transform.match(/matrix\(([^)]+)\)/);
    if (!matrix) return 0;

    const [a, b] = matrix[1].split(',').map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;

    return Math.round(Math.atan2(b, a) * (180 / Math.PI));
}

export default function EnforcementSection() {
    const rootRef = useRef(null);

    useEffect(() => {
        // Listener teardown collected here rather than through ctx.add().
        // gsap.context() invokes its callback synchronously, so a reference to
        // `ctx` inside that callback is read before the const has been assigned
        // -- a temporal dead zone ReferenceError that throws on the client and
        // takes the section down with it. Nothing about it shows up in a build
        // or in server rendering; it only fails once the effect runs in a
        // browser.
        const detach = [];

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

            // Tilt and spacing both belong to the stylesheet: cards.css sets a
            // rotate() per card and mandat.css sets the row's positions. The
            // tilt is read back here so there is a single source of truth, and
            // captured before any hover so the leave handler still knows what
            // "straight" means after the hovered card has been squared up.
            const rest = cards.map((card, i) => ({
                card,
                rotation: restingRotation(card),
                top: card.offsetTop,
                z: i + 1,
            }));

            cards.forEach((card, index) => {
                const onEnter = () => {
                    const hovered = rest[index];

                    // The card under the pointer squares up and comes forward.
                    // This is what makes the gap left behind read as a card
                    // being pulled out rather than a hole in the row: one card
                    // goes straight and sits in front while its neighbours keep
                    // their tilt and slide aside.
                    gsap.to(card, {
                        x: 0,
                        y: TARGET_COMMON_TOP - hovered.top,
                        rotation: 0,
                        scale: 1.08,
                        zIndex: 20,
                        duration: 0.9,
                        ease: 'elastic.out(1, 0.5)',
                        overwrite: true,
                    });

                    // Offsets are measured from the hovered card rather than from
                    // each card's own resting position, which is how the
                    // reference does it. The two only agree when the row is
                    // evenly spaced, and this one is not -- the four slots step
                    // 220, 210 and 270. Done the reference's way, hovering the
                    // first card puts the others at +220, +160 and +40, so the
                    // last two cross back over the second.
                    const push = (entries, direction) => {
                        entries.forEach((entry, i) => {
                            const targetX = direction * (CARD_WIDTH + HOVER_GAP + i * CLUSTER_GAP);
                            const angle = (entry.rotation * Math.PI) / 180;
                            gsap.to(entry.card, {
                                x: targetX,
                                y: targetX * Math.tan(angle),
                                rotation: entry.rotation,
                                scale: 1,
                                duration: 1.0,
                                ease: 'elastic.out(1, 0.5)',
                                overwrite: true,
                            });
                        });
                    };

                    const after = rest.slice(index + 1);
                    const before = rest.slice(0, index).reverse();
                    if (after.length) push(after, 1);
                    if (before.length) push(before, -1);
                };

                const onLeave = () => {
                    // Every card returns to its own slot, tilt and stacking
                    // order. The 80ms delay is the reference's: moving the
                    // pointer onto a neighbouring card fires this and then that
                    // card's enter in the same tick, and the later spread's
                    // overwrite:true discards these tweens before they play. It
                    // is only when the pointer leaves the row for good that they
                    // actually run.
                    rest.forEach((entry) => {
                        gsap.to(entry.card, {
                            x: 0,
                            y: 0,
                            scale: 1,
                            rotation: entry.rotation,
                            zIndex: entry.z,
                            duration: 1.0,
                            ease: 'elastic.out(1, 0.5)',
                            overwrite: true,
                            delay: 0.08,
                        });
                    });
                };

                card.addEventListener('mouseenter', onEnter);
                card.addEventListener('mouseleave', onLeave);
                detach.push(() => {
                    card.removeEventListener('mouseenter', onEnter);
                    card.removeEventListener('mouseleave', onLeave);
                });
            });
        }, rootRef);

        return () => {
            detach.forEach((fn) => fn());
            ctx.revert();
        };
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
        </section>
    );
}