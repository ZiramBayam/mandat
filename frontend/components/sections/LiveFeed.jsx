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

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useCommitFeed } from '@/lib/chain';
import { COMMIT_STATES as RIG_STATES } from '@/lib/motion/rig';
import { COMMIT_STATES, FINALITY } from '@/lib/content';

const CommitLamps = dynamic(() => import('@/lib/motion/CommitLamps').then((m) => m.CommitLamps), {
    ssr: false,
    loading: () => <div className="commit-lamps is-loading" />,
});

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

            <div className="card card-wide lamps-card">
                <div className="lamps-head">
                    <h3>{FINALITY.lampsLabel}</h3>
                    <p className={feed.connected ? 'feed-status is-live' : 'feed-status is-down'}>
                        {feed.connected ? 'connected to monadNewHeads' : 'not connected'}
                    </p>
                </div>
                <p className="lamps-blurb">{FINALITY.lampsBlurb}</p>

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
            </div>
        </section>
    );
}