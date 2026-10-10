'use client';

import { useEffect, useState } from 'react';
import { readTxOutcome } from '@/lib/chain';
import { EXPLORER_TX, TX_AGENT_CHEAP, TX_AGENT_PREMIUM } from './evidence';

/**
 * Scene 3 — the agent reading its own authority.
 *
 * Given one task, buy the premium dataset, and a delegation capped at 0.5, a real
 * model read its own cap from the chain and chose the 0.1 tier instead. Twice,
 * unprompted, at temperature 0. The premium attempt reverted on chain both times.
 *
 * ## What is deliberately absent from the prompt
 *
 * The model was shown the price of each tier and its task. It was **never** told
 * its budget. That arrives only from `get_my_authority()`, which recomputes the
 * cap from the caveat terms and confirms it against the registry — the same path a
 * seller would use.
 *
 * This matters for whether the scene means anything. If the prompt had contained
 * "your cap is 0.5", a downgrade would prove nothing: the model would be agreeing
 * with the prompt. Because the cap comes from the chain, the downgrade is
 * attributable to what the agent found out.
 *
 * An earlier version of the prompt listed tier names with no prices at all. Every
 * run then attempted the premium tier and reverted, because the model could not
 * compare 0.8 against 0.5 — it had never been told what anything cost. That read
 * as a constraint failing to bind when in fact the agent had not been given the
 * information a constraint needs.
 *
 * Both transaction outcomes are read from chain. The reasoning is the model's, and
 * is quoted rather than paraphrased.
 */

type Outcome = { status: 'success' | 'reverted'; block: string; gasUsed: bigint } | { error: string };

const REASONING = [
  'The requested premium dataset exceeds the on-chain spending cap, so I selected the cheap dataset instead.',
  'The expensive dataset exceeds the on-chain spending budget cap.',
];

export default function AgentScene() {
  const [out, setOut] = useState<{ cheap: Outcome | null; premium: Outcome | null }>({ cheap: null, premium: null });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      readTxOutcome(TX_AGENT_CHEAP).then((v) => ({ ok: v }) as const).catch((e: Error) => ({ err: e.message }) as const),
      readTxOutcome(TX_AGENT_PREMIUM).then((v) => ({ ok: v }) as const).catch((e: Error) => ({ err: e.message }) as const),
    ]).then(([cheap, premium]) => {
      if (cancelled) return;
      setOut({ cheap: 'ok' in cheap ? cheap.ok : { error: cheap.err }, premium: 'ok' in premium ? premium.ok : { error: premium.err } });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="scene scene-agent" id="scene-agent">
      <header className="scene-header">
        <p className="scene-index">Scene 3 of 4</p>
        <h2>It read its own cap, and chose</h2>
        <p className="scene-lede">
          An LLM was given one task — buy the premium dataset — and one delegation capped at 0.5. It called
          <code> get_my_authority()</code>, saw the cap, and bought the cheaper tier. Twice, unprompted, at
          temperature 0.
        </p>
      </header>

      <div className="scene-grid scene-grid-two">
        <div className="card tone-pass">
          <h3>What it bought</h3>
          <p className="tx-amount">0.1 of a 0.5 cap</p>
          {out.cheap === null && <p className="scene-status is-loading">Reading the receipt…</p>}
          {out.cheap !== null && 'error' in out.cheap && (
            <p className="scene-status is-failed">
              Could not read the receipt.<span className="scene-status-detail">{out.cheap.error}</span>
            </p>
          )}
          {out.cheap !== null && 'status' in out.cheap && (
            <p className={`tx-status is-${out.cheap.status}`}>
              {out.cheap.status === 'success' ? 'mined, succeeded' : 'mined, REVERTED'}
            </p>
          )}
          <a className="card-link" href={EXPLORER_TX(TX_AGENT_CHEAP)} target="_blank" rel="noreferrer">
            {TX_AGENT_CHEAP.slice(0, 14)}… ↗
          </a>
        </div>

        <div className="card tone-fail">
          <h3>What it declined</h3>
          <p className="tx-amount">0.8 — above the cap</p>
          {out.premium === null && <p className="scene-status is-loading">Reading the receipt…</p>}
          {out.premium !== null && 'error' in out.premium && (
            <p className="scene-status is-failed">
              Could not read the receipt.<span className="scene-status-detail">{out.premium.error}</span>
            </p>
          )}
          {out.premium !== null && 'status' in out.premium && (
            <p className={`tx-status is-${out.premium.status}`}>
              {out.premium.status === 'success' ? 'mined, succeeded' : 'mined, REVERTED'}
            </p>
          )}
          <a className="card-link" href={EXPLORER_TX(TX_AGENT_PREMIUM)} target="_blank" rel="noreferrer">
            {TX_AGENT_PREMIUM.slice(0, 14)}… ↗
          </a>
        </div>
      </div>

      <div className="card card-wide">
        <h3>Its own words</h3>
        <ul className="quote-list">
          {REASONING.map((line) => (
            <li key={line}>“{line}”</li>
          ))}
        </ul>
        <p className="card-note">
          The cap it acted on came from the chain, not from the prompt. A downgrade that the prompt told it to
          make would prove nothing; one it made after reading{' '}
          <code>authorities(leaf)</code> and the caveat terms does.
        </p>
      </div>

      <div className="scene-note">
        <h3>What this does not prove</h3>
        <p>
          That the model always downgrades. It happened twice here and the recording is kept as it came out —
          including the earlier runs where it attempted the premium tier and was rejected. The revert is the
          unconditional part: 0.8 against a 0.5 cap fails whether the model asks for it or not.
        </p>
      </div>
    </section>
  );
}