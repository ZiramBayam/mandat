'use client';

/**
 * The opening.
 *
 * Structure, class names, the word-by-word headline and the smiley, star and
 * oval underline come from the credited site (see README). What changed is the
 * words, and the removal of the video controls.
 *
 * Those controls are gone on purpose rather than hidden. The play, mute and
 * fullscreen buttons all operate on the <video> element, which in the source has
 * no src -- it is a commented-out placeholder over a solid background. Every
 * one of them was a button that did nothing, along with the cursor-following
 * mute bubble whose whole job was to float over the video. The part worth
 * keeping is the headline and its stickers, so that is what this is.
 */

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

export default function VimeoHero() {
    const titleRef = useRef(null);

    // Words rise in sequence. The source let CSS handle the oval underline; the
    // words themselves are staggered here.
    useEffect(() => {
        const title = titleRef.current;
        if (!title) return;
        const words = title.querySelectorAll('.vimeo-hero__word');

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            gsap.set(words, { opacity: 1, yPercent: 0 });
            return;
        }

        gsap.from(words, {
            opacity: 0,
            yPercent: 60,
            duration: 1.1,
            stagger: 0.12,
            ease: 'power3.out',
            delay: 0.4,
        });
    }, []);

    return (
        <div className="vimeo-hero is-paused is-muted">
            <div className="vimeo-hero__fade" />

            <div className="home-header__title">
                <h1 className="vimeo-hero__title" ref={titleRef}>
                    <span className="vimeo-hero__word">an </span>

                    <span className="vimeo-hero__word is--relative">
                        <span>agent </span>
                        <div className="home-header__smiley">
                            <img src="/assets/VimeoHero SVG/smiley-face.svg" alt="" className="home-header__smiley-svg" />
                        </div>
                    </span>

                    <span className="vimeo-hero__word"><em>with </em></span>

                    <span className="vimeo-hero__word">a </span>

                    <div style={{ flexBasis: '100%', height: 0 }} />

                    <span className="vimeo-hero__word">spending </span>
                    <span className="vimeo-hero__word">limit </span>

                    <span className="vimeo-hero__word is--relative">
                        <div className="home-header__star">
                            <div className="home-header__star-inner">
                                <img src="/assets/VimeoHero SVG/pink-star.svg" alt="" className="home-header__star-svg" />
                            </div>
                        </div>
                        <img src="/assets/VimeoHero SVG/oval-underline.svg" alt="" className="home-header__title-line-svg" />
                        <span>it cannot</span>
                    </span>

                    <span className="vimeo-hero__word">get </span>
                    <span className="vimeo-hero__word">around</span>
                </h1>
            </div>
        </div>
    );
}