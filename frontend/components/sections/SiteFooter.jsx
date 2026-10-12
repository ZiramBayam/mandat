'use client';

/**
 * Footer.
 *
 * Layout and the sticker treatment come from the credited site. The links are
 * ours, and there is no credits pop-out here: the one thing this page is honest
 * about is where its design came from, and that belongs in the README rather
 * than hidden behind a hover.
 */

import { EVIDENCE, FINALITY, FOOTER_LINKS, PACKAGES } from '@/lib/content';

export default function SiteFooter() {
    return (
        <footer className="main-footer mandat-footer" id="footer">
            <div className="footer-inner">
                <div className="footer-lead">
                    <h2 className="footer-title">
                        {FINALITY.title} <span className="footer-title-accent">{FINALITY.titleAccent}</span>
                    </h2>
                    <p className="footer-note">{FINALITY.footerNote}</p>
                </div>

                <div className="footer-sticker">
                    <img
                        src="/assets/Footer-Sticker SVG/footer-sticker-hands.svg"
                        className="footer-sticker-img"
                        alt=""
                        aria-hidden="true"
                    />
                </div>

                <dl className="footer-facts">
                    <div>
                        <dt>Registry</dt>
                        <dd>
                            <a href={`https://testnet.monadvision.com/address/${EVIDENCE.registry}`} target="_blank" rel="noreferrer">
                                {EVIDENCE.registry.slice(0, 8)}…{EVIDENCE.registry.slice(-4)}
                            </a>
                        </dd>
                    </div>
                    <div>
                        <dt>Enforcer</dt>
                        <dd>
                            <a href={`https://testnet.monadvision.com/address/${EVIDENCE.enforcer}`} target="_blank" rel="noreferrer">
                                {EVIDENCE.enforcer.slice(0, 8)}…{EVIDENCE.enforcer.slice(-4)}
                            </a>
                        </dd>
                    </div>
                    <div>
                        <dt>Root</dt>
                        <dd>
                            <a href={`https://testnet.monadvision.com/address/${EVIDENCE.root}`} target="_blank" rel="noreferrer">
                                {EVIDENCE.root.slice(0, 8)}…{EVIDENCE.root.slice(-4)}
                            </a>
                        </dd>
                    </div>
                </dl>

                {/* The package names used to run through the marquee, where
                    they read as a build log and did not fit the boxes. Being read
                    is the whole point of a footer. */}
                <ul className="footer-packages">
                    {PACKAGES.map((name) => (
                        <li key={name}>{name}</li>
                    ))}
                </ul>

                <nav className="footer-links" aria-label="Elsewhere">
                    {FOOTER_LINKS.map((link) => (
                        <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="footer-link">
                            {link.label}
                        </a>
                    ))}
                </nav>
            </div>
        </footer>
    );
}