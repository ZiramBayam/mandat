'use client';

/**
 * Mandat — four scenes, one page.
 *
 *   1 Authority    the permission that was minted, and the four states it passes through
 *   2 Enforcement what the contract refuses to do
 *   3 Agent        an LLM reading its own cap and choosing a tier
 *   4 Finality     commitState lamps driven by a live WebSocket
 *
 * The animation layer, the layout vocabulary and the section shells came from a
 * credited third-party agency site (see README). What renders here is ours: every
 * word is in lib/content.ts, and every value that is chain state is read from
 * Monad at runtime rather than asserted by the page (working/constraints.md R6).
 */

import SvgSymbols from '@/components/SvgSymbols';
import Navbar from '@/components/Navbar';
import { SmoothScroll } from '@/lib/motion';
import CursorBubble from '@/components/CursorBubble';
import TransitionScribble from '@/components/TransitionScribble';

import AuthoritySection from '@/components/sections/AuthoritySection';
import EnforcementSection from '@/components/sections/EnforcementSection';
import AgentSection from '@/components/sections/AgentSection';
import FinalitySection from '@/components/sections/FinalitySection';
import SiteFooter from '@/components/sections/SiteFooter';

export default function Home() {
    return (
        <>
            <SvgSymbols />
            <SmoothScroll />
            <CursorBubble />
            <header className="main-header">
                <Navbar />
            </header>
            <main>
                <AuthoritySection />
                <EnforcementSection />
                <AgentSection />
                <FinalitySection />
                <SiteFooter />
            </main>
            <TransitionScribble />
        </>
    );
}