'use client';

/**
 * The live commit feed.
 *
 * This section occupies the slot the source site left as an unfinished stub --
 * a heading and "Will be created soon". Nothing was copied from it; the slot was
 * simply the right place for the one thing on this page that is live.
 *
 * Monad reports a commit state on every block and it exists nowhere else, so it
 * is read from a WebSocket rather than polled. The four states are also
 * selectable: the rows say what each is and whether it has been reached, and
 * choosing one explains it. That is deliberate -- the sweeping word animation
 * above is the garnish, and content should not depend on an animation being
 * watched to the end.
 *
 * Nothing here is mocked. If the socket is down the page says so rather than
 * playing something reassuring.
 */

import { useState } from 'react';
import { useCommitFeed } from '@/lib/chain';
import { CommitLamps, CommitLampShapes } from '@/lib/motion/CommitLamps';
import { COMMIT_STATES as RIG_STATES } from '@/lib/motion/rig';
import { COMMIT_STATES, EVIDENCE, FINALITY } from '@/lib/content';

export default function LiveFeed() {
    const feed = useCommitFeed();
    const [selected, setSelected] = useState(null);
    const detail = COMMIT_STATES.find((s) => s.key === selected);

    return (
        <section className="content-section live-feed" id="live">
            <div className="title-container">
                <h2 className="main-title">
                    what the chain says <span className="italic-text">right now:</span>
                </h2>
            </div>

            <div className="lamps-card">
                <div className="lamps-head">
                    <h3>{FINALITY.lampsLabel}</h3>
                    <p className={feed.connected ? 'feed-status is-live' : 'feed-status is-down'}>
                        {feed.connected ? 'connected to monadNewHeads' : 'not connected'}
                    </p>
                </div>
                <p className="lamps-blurb">{FINALITY.lampsBlurb}</p>

                <CommitLampShapes />
                <CommitLamps reached={feed.lastCommitState} connected={feed.connected} />

                <ul className="commit-lamps-fallback">
                    {RIG_STATES.map((state, i) => {
                        const meta = COMMIT_STATES[i];
                        const lit = feed.connected && feed.lastCommitState !== null && RIG_STATES.indexOf(feed.lastCommitState) >= i;
                        const isSelected = selected === meta.key;
                        return (
                            <li key={state}>
                                <button
                                    type="button"
                                    className={lit ? 'is-lit' : ''}
                                    data-state={state}
                                    aria-pressed={isSelected}
                                    onClick={() => setSelected(isSelected ? null : meta.key)}
                                >
                                    <span className="lamp-dot" aria-hidden="true" />
                                    <span className="lamp-name">{meta.label}</span>
                                    <span className="lamp-status">
                                        {!feed.connected ? 'unknown' : lit ? 'reached' : 'pending'}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>

                <p className="state-detail" aria-live="polite">
                    {detail ? detail.blurb : 'Pick a step above to see what it means.'}
                </p>

                <dl className="feed-facts">
                    <div>
                        <dt>blocks seen</dt>
                        <dd>{feed.heads.toString()}</dd>
                    </div>
                    <div>
                        <dt>final floor</dt>
                        <dd>{feed.finalFloor.toString()}</dd>
                    </div>
                    <div>
                        <dt>last state</dt>
                        <dd>{feed.lastCommitState ?? 'unknown'}</dd>
                    </div>
                </dl>

                {/* Two recorded transactions rather than live ones, so they sit
                    at the foot of the panel rather than above the lamp strip:
                    everything above them is what the chain is saying right now,
                    these two are what it said when it was run deliberately. They
                    were under the enforcement section, where they were literal
                    evidence for the cards above them, but four saturated cards
                    and two small chips in one section fought each other and the
                    chips lost -- they ended up behind the cards. */}
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
            </div>
        </section>
    );
}