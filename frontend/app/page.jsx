'use client';

/**
 * Mandat — four scenes, one page.
 *
 * The scene order is fixed by working/prd.md §6 and each one carries evidence:
 *
 *   1 Envelope    the permission that was minted, and what it costs
 *   2 Enforcement a redeem under the cap, and one over it that reverts on chain
 *   3 Agent       an LLM reading its own cap and choosing a tier
 *   4 Finality    commitState lamps, then revocation killing the subtree
 *
 * The animation layer came from a third-party site and is credited in the README.
 * What renders here is ours: every value on this page is read from Monad at
 * runtime, never asserted by the page itself (working/constraints.md R6).
 */

import SvgSymbols from '@/components/SvgSymbols';
import Navbar from '@/components/Navbar';
import { SmoothScroll } from '@/lib/motion';
import CursorBubble from '@/components/CursorBubble';
import TransitionScribble from '@/components/TransitionScribble';

import EnvelopeScene from '@/components/scenes/EnvelopeScene';
import EnforcementScene from '@/components/scenes/EnforcementScene';
import AgentScene from '@/components/scenes/AgentScene';
import FinalityScene from '@/components/scenes/FinalityScene';

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
                <EnvelopeScene />
                <EnforcementScene />
                <AgentScene />
                <FinalityScene />
            </main>
            <TransitionScribble />
        </>
    );
}