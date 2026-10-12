'use client';

/**
 * Mandat — the page, in the source site's section order.
 *
 *   Navbar + hero          the opening
 *   HorizontalWords        the four states, swept across the screen
 *   MotionCards            the fanned cards
 *   Showreel slot          the live commit feed
 *   ServiceCards           the fanned enforcement cards
 *   DoubleMarquee          what the system does
 *   Footer
 *
 * The order, the wrappers and the class names come from the credited site (see
 * README). What is ours is the words and the data: every value that is chain
 * state is read from Monad at runtime rather than asserted by the page
 * (working/constraints.md R6).
 */

import SvgSymbols from '@/components/SvgSymbols';
import Navbar from '@/components/Navbar';
import VimeoHero from '@/components/VimeoHero';
import { SmoothScroll } from '@/lib/motion';
import CursorBubble from '@/components/CursorBubble';
import TransitionScribble from '@/components/TransitionScribble';

import FinalitySection from '@/components/sections/FinalitySection';
import AuthoritySection from '@/components/sections/AuthoritySection';
import LiveFeed from '@/components/sections/LiveFeed';
import EnforcementSection from '@/components/sections/EnforcementSection';
import AgentSection from '@/components/sections/AgentSection';
import Footer from '@/components/Footer';

export default function Home() {
    return (
        <>
            <SvgSymbols />
            <SmoothScroll />
            <CursorBubble />
            <header className="main-header">
                <Navbar />
                <VimeoHero />
            </header>
            <FinalitySection />
            <main>
                <div className="content-section motion-cards-wrapper">
                    <AuthoritySection />
                </div>
                <LiveFeed />
                <div className="content-section service-cards-wrapper">
                    <EnforcementSection />
                </div>
            </main>
            <section className="Double-marquee">
                <AgentSection />
            </section>
            <footer className="main-footer">
                <Footer />
            </footer>
            <TransitionScribble />
        </>
    );
}