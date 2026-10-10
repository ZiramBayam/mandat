'use client';

import dynamic from 'next/dynamic';
import { useCommitFeed } from '@/lib/chain';
import { COMMIT_STATES } from '@/lib/motion/rig';
import { EXPLORER_ADDRESS, REGISTRY } from './evidence';

/**
 * Scene 4 — finality, then revocation.
 *
 * Two separate claims, and they are usually conflated.
 *
 * **Finality.** Monad reports a `commitState` on its WebSocket feed and nowhere
 * else. There is no `eth_getBlockByNumber` field for it, so it cannot be polled;
 * a socket has to be open before the payment to see the first lamp. The four
 * states below advance live from that feed.
 *
 * **Revocation.** Withdrawing a delegation kills its whole subtree, on chain, in
 * one call. The row stays — `isRegistered` is still true — but `isLive` goes
 * false and the child cannot redeem. That is the difference between a record being
 * deleted and authority being withdrawn.
 *
 * The lamps are the Three.js component, loaded lazily so WebGL stays out of the
 * initial bundle. When there is no WebGL the plain list takes over: the states are
 * the evidence, so they have to survive a machine that cannot render them.
 */

const CommitLamps = dynamic(() => import('@/lib/motion/CommitLamps').then((m) => m.CommitLamps), {
  ssr: false,
  loading: () => <div className="commit-lamps is-loading" />,
});

export default function FinalityScene() {
  const feed = useCommitFeed();

  return (
    <section className="scene scene-finality" id="scene-finality">
      <header className="scene-header">
        <p className="scene-index">Scene 4 of 4</p>
        <h2>Four lamps, then the switch</h2>
        <p className="scene-lede">
          Monad reports a commit state on every block, and it exists nowhere else. These lamps are fed by a
          live WebSocket subscription, not by polling.
        </p>
      </header>

      <div className="card card-wide lamps-card">
        <div className="lamps-head">
          <h3>Live commit feed</h3>
          <p className={feed.connected ? 'feed-status is-live' : 'feed-status is-down'}>
            {feed.connected ? 'subscribed to monadNewHeads' : 'not connected'}
          </p>
        </div>

        <CommitLamps reached={feed.lastCommitState} connected={feed.connected} />

        <ol className="commit-lamps-fallback">
          {COMMIT_STATES.map((state, i) => {
            const lit = feed.connected && feed.lastCommitState !== null && COMMIT_STATES.indexOf(feed.lastCommitState) >= i;
            return (
              <li key={state} className={lit ? 'is-lit' : ''} data-state={state}>
                <span className="lamp-dot" aria-hidden="true" />
                <span className="lamp-name">{state}</span>
                <span className="lamp-status">
                  {!feed.connected ? 'unknown' : lit ? 'reached' : 'pending'}
                </span>
              </li>
            );
          })}
        </ol>

        <dl className="feed-facts">
          <div>
            <dt>heads</dt>
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

        {!feed.connected && (
          <p className="scene-status is-failed">
            The socket is down, so the lamps are dark. They are not showing a stale value: an unknown commit
            state withholds, exactly as the seller withholds. A frozen “Finalized” would be the failure this
            project exists to prevent.
          </p>
        )}
      </div>

      <div className="scene-note">
        <h3>Then the switch</h3>
        <p>
          Withdrawing a delegation from the authority graph does not delete its row.{' '}
          <code>isRegistered</code> stays <code>true</code>; <code>isLive</code> becomes <code>false</code>, and
          the next redemption reverts on chain.
        </p>
        <p>
          That is the difference between erasing a record and withdrawing authority, and it is why revocation
          is a field with a timestamp rather than a delete. Read it yourself on the explorer:{' '}
          <a href={EXPLORER_ADDRESS(REGISTRY)} target="_blank" rel="noreferrer" className="card-link">
            the registry ↗
          </a>
        </p>
      </div>
    </section>
  );
}