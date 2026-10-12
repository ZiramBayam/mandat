'use client';

/**
 * Scene 2 -- enforcement.
 *
 * Four cards, four claims, each one already confirmed by a transaction on Monad
 * testnet. The card layout, the underlines and the bullet glyphs come from the
 * credited site; the claims are ours and are the reason the page exists.
 */

import { ENFORCEMENT, EVIDENCE } from '@/lib/content';

export default function EnforcementSection() {
    return (
        <section className="enforcement-section" id="enforcement">
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
                {ENFORCEMENT.cards.map((card) => (
                    <div key={card.title} className={`card card-${card.color}`}>
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

            {/* The two transactions that make the section checkable rather than
                decorative. Both links open the explorer, so a reader can confirm
                the claim without trusting this page. */}
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