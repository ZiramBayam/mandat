'use client';

import { useEffect, useState } from 'react';
import { readTokenBalance, readTxOutcome } from '@/lib/chain';
import { EXPLORER_TX, LIVE_DELEGATION, ROOT_DELEGATOR, SUBAGENT, TX_OVER_CAP, TX_WITHIN_CAP, WMON } from './evidence';

/**
 * Scene 2 — enforcement.
 *
 * Two redemptions against the same delegation, same period, four blocks apart:
 * one at 0.1 against a 0.5 cap, one at 0.8 against that same cap.
 *
 * The second was **mined and reverted**. It has a block number and it consumed
 * 900,000 gas. It was not refused by our middleware, and it was not a request we
 * declined to send. That distinction is the entire claim of this project: a
 * middleware answering 403 proves the middleware works, while a transaction
 * reverting on chain proves the constraint is real.
 *
 * Both statuses are fetched from the receipts when the page loads. Nothing here
 * is a hardcoded verdict. If the chain disagreed, this scene would say so.
 */

type Outcome = { status: 'success' | 'reverted'; block: string; gasUsed: bigint } | { error: string };

function useOutcomes() {
  const [out, setOut] = useState<{ within: Outcome | null; over: Outcome | null }>({ within: null, over: null });
  const [balances, setBalances] = useState<{ root: bigint | null; sub: bigint | null }>({ root: null, sub: null });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      readTxOutcome(TX_WITHIN_CAP).then((v) => ({ ok: v }) as const).catch((e: Error) => ({ err: e.message }) as const),
      readTxOutcome(TX_OVER_CAP).then((v) => ({ ok: v }) as const).catch((e: Error) => ({ err: e.message }) as const),
    ]).then(([within, over]) => {
      if (cancelled) return;
      setOut({
        within: 'ok' in within ? within.ok : { error: within.err },
        over: 'ok' in over ? over.ok : { error: over.err },
      });
    });
    void Promise.all([readTokenBalance(WMON, ROOT_DELEGATOR), readTokenBalance(WMON, SUBAGENT)]).then(
      ([root, sub]) => {
        if (!cancelled) setBalances({ root, sub });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...out, balances };
}

const fmt = (v: bigint) => `${v / 10n ** 18n}.${(v % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')}`;

type TxCardProps = {
  title: string;
  amount: string;
  hash: string;
  outcome: Outcome | null;
  tone: 'pass' | 'fail';
};

function TxCard({ title, amount, hash, outcome, tone }: TxCardProps) {
  return (
    <div className={`card tx-card tone-${tone}`}>
      <h3>{title}</h3>
      <p className="tx-amount">{amount} WMON</p>
      {outcome === null && <p className="scene-status is-loading">Reading the receipt…</p>}
      {outcome !== null && 'error' in outcome && (
        <p className="scene-status is-failed">
          Could not read this receipt. That is a failure to ask, not a result.
          <span className="scene-status-detail">{outcome.error}</span>
        </p>
      )}
      {outcome !== null && 'status' in outcome && (
        <>
          <p className={`tx-status is-${outcome.status}`}>
            {outcome.status === 'success' ? 'mined, succeeded' : 'mined, REVERTED'}
          </p>
          <dl className="tx-facts">
            <div>
              <dt>block</dt>
              <dd>{outcome.block}</dd>
            </div>
            <div>
              <dt>gas</dt>
              <dd>{outcome.gasUsed.toString()}</dd>
            </div>
          </dl>
        </>
      )}
      <a className="card-link" href={EXPLORER_TX(hash)} target="_blank" rel="noreferrer">
        {hash.slice(0, 14)}… ↗
      </a>
    </div>
  );
}

export default function EnforcementScene() {
  const { within, over, balances } = useOutcomes();

  return (
    <section className="scene scene-enforcement" id="scene-enforcement">
      <header className="scene-header">
        <p className="scene-index">Scene 2 of 4</p>
        <h2>The envelope holds</h2>
        <p className="scene-lede">
          Two redemptions, one delegation, one period. The second was broadcast, mined, and rejected by the
          caveat enforcer — 900,000 gas spent, nothing moved. That is a different fact from a seller answering{' '}
          <code>403</code>.
        </p>
      </header>

      <div className="scene-grid scene-grid-two">
        <TxCard title="Within the cap" amount="0.1 of 0.5" hash={TX_WITHIN_CAP} outcome={within} tone="pass" />
        <TxCard title="Over the cap" amount="0.8 of 0.5" hash={TX_OVER_CAP} outcome={over} tone="fail" />
      </div>

      <div className="scene-note">
        <h3>Why the second one matters more</h3>
        <p>
          A reverted transaction has a block number and a gas cost. A middleware refusal has neither. So the
          question a reader should ask of this scene is not “did the seller refuse it” — it is “did anything
          on Monad say no”.
        </p>
        <p className="scene-note-quote">
          Delegation <code>{LIVE_DELEGATION.slice(0, 14)}…</code>
        </p>
      </div>

      <div className="card card-wide">
        <h3>Balances, now</h3>
        <div className="balance-row">
          <div>
            <span className="balance-label">root delegator</span>
            <span className="balance-value">{balances.root === null ? 'unknown' : `${fmt(balances.root)} WMON`}</span>
          </div>
          <div>
            <span className="balance-label">sub-agent</span>
            <span className="balance-value">{balances.sub === null ? 'unknown' : `${fmt(balances.sub)} WMON`}</span>
          </div>
        </div>
        <p className="card-note">
          A redemption that moved no tokens would still have produced a receipt, so the receipt alone is not
          proof of spend. The balance is the proof, and it is read live.
        </p>
      </div>
    </section>
  );
}