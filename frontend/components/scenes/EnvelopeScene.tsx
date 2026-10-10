'use client';

import { useEffect, useState } from 'react';
import type { Hex } from 'viem';
import { readTokenBalance, readTxOutcome, useAgentId, useDelegationState, useLineage, useManifestCid, type Async } from '@/lib/chain';
import {
  AGENT, CAP_BASE_UNITS, EXPLORER_ADDRESS, LIVE_DELEGATION, MANIFEST, PERIOD_SECONDS,
  REGISTRY, ROOT_DELEGATOR, SUBAGENT, WMON,
} from './evidence';

/**
 * Scene 1 — the envelope.
 *
 * An agent holds a permission, not a key. What follows is that permission, read
 * back out of the registry: who authorised it, what it is capped at, when it
 * expires, and which manifest it is bound to.
 *
 * The cap is shown with its token everywhere. A cap without a token is
 * meaningless, and not incidentally: 0.5 WMON is 5e17 base units and 0.5 USDC is
 * 5e5. A reader who saw "0.5" against a balance of 500000000000000000 would
 * conclude the budget was enormous. That confusion happened once during
 * development, so the token travels with the number by construction.
 */

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="evidence-row">
      <span className="evidence-label">{label}</span>
      <span className={mono === true ? 'evidence-value is-mono' : 'evidence-value'}>{children}</span>
    </div>
  );
}

function Loading({ what }: { what: string }) {
  return <p className="scene-status is-loading">Reading {what} from Monad…</p>;
}

function Failed({ what, error }: { what: string; error: string }) {
  // A failed read is not a zero and not a success. Saying so is the whole reason
  // the read states are kept distinct.
  return (
    <p className="scene-status is-failed">
      Could not read {what}. This is a failure to ask the chain, not a fact about it.
      <span className="scene-status-detail">{error}</span>
    </p>
  );
}

export default function EnvelopeScene() {
  const delegation = useDelegationState(REGISTRY, LIVE_DELEGATION as Hex);
  const lineage = useLineage(REGISTRY, LIVE_DELEGATION as Hex);
  const cid = useManifestCid(REGISTRY, MANIFEST as Hex);
  const agentId = useAgentId(REGISTRY, AGENT);

  const [balances, setBalances] = useState<{ root: bigint | null; sub: bigint | null }>({ root: null, sub: null });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([readTokenBalance(WMON, ROOT_DELEGATOR), readTokenBalance(WMON, SUBAGENT)]).then(
      ([root, sub]) => {
        if (!cancelled) setBalances({ root, sub });
      },
      () => {
        if (!cancelled) setBalances({ root: null, sub: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const pretty = (v: bigint, decimals = 18) => {
    const whole = v / 10n ** BigInt(decimals);
    const frac = (v % 10n ** BigInt(decimals)).toString().padStart(decimals, '0').replace(/0+$/, '');
    return frac.length > 0 ? `${whole}.${frac}` : whole.toString();
  };

  return (
    <section className="scene scene-envelope" id="scene-envelope">
      <header className="scene-header">
        <p className="scene-index">Scene 1 of 4</p>
        <h2>The envelope</h2>
        <p className="scene-lede">
          The agent holds a permission, not a key. Everything below is read from <code>AuthorityRegistry</code> on
          Monad testnet at the moment you loaded this page.
        </p>
      </header>

      <div className="scene-grid">
        <div className="card">
          <h3>Authority</h3>
          {delegation.state === 'loading' && <Loading what="the delegation" />}
          {delegation.state === 'failed' && <Failed what="the delegation" error={delegation.error} />}
          {delegation.state === 'ready' && delegation.value.exists && (
            <>
              <Row label="Delegator" mono>
                {delegation.value.meta?.delegator}
              </Row>
              <Row label="Delegate" mono>
                {delegation.value.meta?.delegate}
              </Row>
              <Row label="Agent id">{agentId.state === 'ready' ? agentId.value.toString() : '—'}</Row>
              <Row label="Parent" mono>
                {delegation.value.meta?.parentHash === (`0x${'ff'.repeat(32)}` as Hex) ? 'ROOT_AUTHORITY' : delegation.value.meta?.parentHash}
              </Row>
              <Row label="Live">{delegation.value.isLive ? 'yes' : 'no — revoked'}</Row>
              <p className="card-note">
                <a href={EXPLORER_ADDRESS(REGISTRY)} target="_blank" rel="noreferrer" className="card-link">
                  the registry on MonadVision ↗
                </a>
              </p>
            </>
          )}
          {delegation.state === 'ready' && !delegation.value.exists && (
            <p className="scene-status is-failed">
              No such delegation in the registry. A zeroed row is an absent row, not an empty one.
            </p>
          )}
        </div>

        <div className="card">
          <h3>What it may spend</h3>
          <Row label="Cap" mono>
            {pretty(CAP_BASE_UNITS)} {WMON.slice(0, 8)}… <span className="unit-note">(base units, 18 decimals)</span>
          </Row>
          <Row label="Period">{PERIOD_SECONDS.toString()} seconds</Row>
          <Row label="Root balance" mono>
            {balances.root === null ? 'unknown' : `${pretty(balances.root)} WMON`}
          </Row>
          <Row label="Agent" mono>{AGENT.slice(0, 10)}…</Row>
          <p className="card-note">
            The cap is not the balance. The contract enforces the cap; the balance is only what happens to be
            there today. Showing the two together is the point.
          </p>
        </div>

        <div className="card">
          <h3>What it is bound to</h3>
          {cid.state === 'loading' && <Loading what="the manifest CID" />}
          {cid.state === 'failed' && <Failed what="the manifest CID" error={cid.error} />}
          {cid.state === 'ready' && (
            <>
              <Row label="Manifest" mono>
                {cid.value === '' ? 'none recorded' : cid.value}
              </Row>
              <Row label="Manifest hash" mono>
                {MANIFEST.slice(0, 14)}…
              </Row>
            </>
          )}
          {lineage.state === 'ready' && (
            <Row label="Hops">
              {lineage.value.chain.length}
              {lineage.value.truncated ? ' (TRUNCATED — not the whole chain)' : ''}
            </Row>
          )}
          <p className="card-note">
            A truncated lineage is shown as truncated. It would otherwise read as a short authority path when
            there may be more hops above.
          </p>
        </div>
      </div>
    </section>
  );
}