'use client';

import { useEffect } from 'react';
import { gsap } from 'gsap';
import { WIGGLE_CONFIG } from '@/lib/data';
import { ScrollTo } from '@/lib/motion';

/* The section ids match the ids on the sections themselves, so these links and
   the page agree by construction rather than by two lists kept in step. */
const SECTIONS = [
    { id: '#authority', label: 'authority' },
    { id: '#enforcement', label: 'enforcement' },
    { id: '#agent', label: 'agent' },
    { id: '#finality', label: 'finality' },
];

function initWiggle(element, intensity) {
    const target = element.querySelector('[data-wiggle-target]') || element;
    gsap.set(target, { transformOrigin: 'center center' });
    let tween;
    const onEnter = () => {
        tween = gsap.to(target, { rotation: intensity, duration: 0.17, repeat: -1, yoyo: true, ease: 'steps(1)' });
    };
    const onLeave = () => {
        if (tween) { tween.kill(); gsap.to(target, { rotation: 0, duration: 0.3, ease: 'power2.out' }); }
    };
    element.addEventListener('mouseenter', onEnter);
    element.addEventListener('mouseleave', onLeave);
    return () => {
        element.removeEventListener('mouseenter', onEnter);
        element.removeEventListener('mouseleave', onLeave);
    };
}

export default function Navbar() {
    useEffect(() => {
        const navbar = document.querySelector('.navbar');
        const contentSection = document.querySelector('.content-section');
        const footerEl = document.querySelector('.main-footer');

        // ② Start white (on-dark) — video is dark background
        if (navbar) { navbar.classList.add('on-dark'); navbar.classList.remove('on-light'); }

        const updateNavbarColor = () => {
            if (!navbar || !contentSection || !footerEl) return;
            const scrollPos = window.scrollY + navbar.offsetHeight / 2;
            const contentTop = contentSection.getBoundingClientRect().top + window.scrollY;

            const showreelSection = document.querySelector('#showreel-section');
            const showreelTop = showreelSection ? showreelSection.getBoundingClientRect().top + window.scrollY : Infinity;

            const serviceCardsSection = document.querySelector('.service-cards-wrapper');
            const serviceCardsTop = serviceCardsSection ? serviceCardsSection.getBoundingClientRect().top + window.scrollY : Infinity;

            const doubleMarquee = document.querySelector('.Double-marquee');
            const doubleMarqueeTop = doubleMarquee ? doubleMarquee.getBoundingClientRect().top + window.scrollY : Infinity;
            const footerTop = footerEl.getBoundingClientRect().top + window.scrollY;

            if (scrollPos >= footerTop) {
                navbar.classList.add('on-dark'); navbar.classList.remove('on-light');
            } else if (scrollPos >= doubleMarqueeTop) {
                navbar.classList.add('on-light'); navbar.classList.remove('on-dark');
            } else if (scrollPos >= serviceCardsTop) {
                navbar.classList.add('on-light'); navbar.classList.remove('on-dark');
            } else if (scrollPos >= showreelTop) {
                navbar.classList.add('on-dark'); navbar.classList.remove('on-light');
            } else if (scrollPos >= contentTop) {
                navbar.classList.add('on-light'); navbar.classList.remove('on-dark');
            } else {
                navbar.classList.add('on-dark'); navbar.classList.remove('on-light');
            }
        };

        window.addEventListener('scroll', updateNavbarColor);
        updateNavbarColor();

        /* Hide on the way down, bring it back on the way up.
           Direction, not position: a header that only came back at the top of the
           page would be useless for reading further down. A dead zone near the
           very top keeps it from flickering when the page settles. */
        let lastY = window.scrollY;
        const updateNavbarVisibility = () => {
            const y = Math.max(0, window.scrollY);
            const delta = y - lastY;
            if (Math.abs(delta) < 6) return;
            navbar.classList.toggle('is-hidden', delta > 0 && y > 140);
            lastY = y;
        };
        window.addEventListener('scroll', updateNavbarVisibility, { passive: true });

        // Wiggle on the wordmark
        const cleanups = [];
        const brand = document.querySelector('.nav-brand');
        if (brand) cleanups.push(initWiggle(brand, WIGGLE_CONFIG.logoMandat));

        const overlay = document.querySelector('.nav-overlay');
        if (overlay) {
            gsap.set(overlay, { opacity: 0, visibility: 'hidden' });
        }
        const showOverlay = () => {
            if (overlay) {
                gsap.set(overlay, { visibility: 'visible' });
                gsap.to(overlay, { opacity: 1, duration: 0.35, ease: 'power2.out' });
            }
        };
        const hideOverlay = () => {
            if (overlay) {
                gsap.to(overlay, { opacity: 0, duration: 0.3, ease: 'power2.in', onComplete: () => gsap.set(overlay, { visibility: 'hidden' }) });
            }
        };


        return () => {
            window.removeEventListener('scroll', updateNavbarVisibility);
            window.removeEventListener('scroll', updateNavbarColor);
            cleanups.forEach(fn => fn && fn());
        };
    }, []);

    return (
        <>
            <div className="nav-overlay"></div>
            <nav className="navbar">
                {/* Left: the wordmark. Doubles as the way home and as the
                    trigger for the scribble transition. The vector logo this
                    replaced was the source company's mark, byte-for-byte -- the
                    element had been renamed but the artwork had not. */}
                <div className="nav-left">
                    <ScrollTo
                        target="#top"
                        className="nav-brand"
                        aria-label="Mandat, back to top"
                    >
                        mandat
                    </ScrollTo>
                </div>

                {/* Centre: direct links to each scene, so a visitor can jump
                    rather than scroll the whole page to find one. Hidden on
                    narrow screens, where four links plus the wordmark do not
                    fit across the top. */}
                <nav className="nav-sections" aria-label="Sections">
                    {SECTIONS.map((section) => (
                        <ScrollTo key={section.id} target={section.id} className="nav-sections__link">
                            {section.label}
                        </ScrollTo>
                    ))}
                </nav>

                {/* Right: a single link out to the repository. The WhatsApp
                    icon it replaced pointed at the source company's phone
                    number. */}
                <div className="nav-right">
                    <a
                        href="https://github.com/ZiramBayam/mandat"
                        className="nav-source"
                        target="_blank"
                        rel="noreferrer"
                    >
                        source
                    </a>
                </div>
            </nav>
        </>
    );
}
