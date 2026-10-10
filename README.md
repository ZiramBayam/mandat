# Mandat

**User-owned authority for agents and skills on Monad.**

An agent does not hold a key. It holds an *envelope*: a permission that a contract
on Monad can cap, revoke, and enforce — without the platform holding anything on
the user's behalf.

Every claim in this README is backed by a transaction on Monad **testnet** (chain
10143) and a block number you can look up. Addresses and hashes:
[`contracts/deployments.md`](contracts/deployments.md).

---

## The one thing to look at first

Two transactions, same delegation, same period, 1 second apart:

| | Tx | Result |
|---|---|---|
| Redeem **0.1 WMON**, cap is 0.5 | [`0x8c3f36…`](https://testnet.monadvision.com/tx/0x8c3f365859ab4a78de9b4bd26b9cbdb0cf6d37f01412022a5df369d41f6c3b00) | **mined, success** |
| Redeem **0.8 WMON**, cap is 0.5 | [`0x0a2c43…`](https://testnet.monadvision.com/tx/0x0a2c43451a899cefe9855998e5f6e6dac089b8a8b921b3832ed93b0dcced0e15) | **mined, reverted** |

The second transaction was broadcast, mined, and reverted **by DTK's own
enforcer** — 900k gas consumed, zero tokens moved. Not our middleware declining
to answer, not a script refusing to send. A reverted transaction has a block
number and a gas cost; a middleware refusal has neither.

That distinction is the whole project. A seller answering `403` proves the seller
works. A transaction reverting on chain proves the *constraint* is real.

---

## What this is

Three parts, each independently checkable:

**1. An on-chain authority graph.** `AuthorityRegistry` records who authorised
whom. `revokeDelegation` on a parent kills the whole subtree, on chain, in one
call. Verified: revoking a parent left both rows `isRegistered == true`, both
`isLive == false`, and the child could no longer redeem.

**2. A permission envelope per skill.** A skill gets a delegation carrying
caveats: only this contract, only these two function selectors, at most 0.5 WMON
per 24 hours, expires 7 days, this manifest CID. The skill never sees a private
key. The caveats are hashed into the delegation, so they cannot be edited after
the fact.

**3. Three-Light.** Monad reports a `commitState` on its WebSocket feed —
`Proposed`, `Voted`, `Finalized`, `Verified` — that exists **nowhere else** and
cannot be polled. A seller withholds a paid resource until the required lamp
lights, and **clears the lamps if the socket drops** rather than freezing on the
last known state.

**4. An agent that limits itself.** Given one task — buy the premium dataset —
and a delegation capped at 0.5 WMON, a real model read its own cap from the
chain and chose the 0.1 tier on its own, twice, with no instruction to
downgrade. Asking for the 0.8 tier reverted on chain both times:

| | Purchase 0.1 | Premium 0.8 |
|---|---|---|
| [run 1](https://testnet.monadvision.com/tx/0xf6ff1dfd267d81708f787908b2f74fd1d60e00e29ec99ff5ab08196c4854b6a6) | **success** | [reverted](https://testnet.monadvision.com/tx/0x04621edfb228a0185b071bc5bc9d6b1e729d0a716198208241c16b91b7e87bb9) |
| [run 2](https://testnet.monadvision.com/tx/0x1be2c572ac9d1d31c726b896f50e287009a68f399edbaf349fe06c275f2ddd94) | **success** | [reverted](https://testnet.monadvision.com/tx/0x13ebf10a59a6b69a7a13d8ae799e1bb1ac291590a8244ecf387b1d0c4e3dad84) |

The cap it reads is recomputed from the caveats and confirmed against chain, not
taken from the header, and it picks a tier *name* — the runner supplies the price.
Otherwise a downgrade would prove nothing. Full record and the three runs that
are honestly not evidence:
[`contracts/deployments.md`](contracts/deployments.md#s5--an-agent-that-reads-its-own-cap).

---

## Running it

Requires Node ≥ 22, pnpm, and Foundry.

```bash
git clone <this repo> && cd mandat
git submodule update --init --recursive   # 12 pinned submodules
pnpm install
pnpm typecheck && pnpm test               # 118 tests
forge test --root contracts               # 80 tests
```

Submodules are pinned to exact commits: DTK v1.3.0, OpenZeppelin v5.4.0. Foundry
solc is `0.8.23`, `evm_version = cancun`.

### Fund the accounts

Testnet MON, 1 MON per request, no key needed:

```bash
curl -X POST https://agents.devnads.com/v1/faucet \
  -H "Content-Type: application/json" \
  -d '{"chainId":10143,"address":"0x..."}'
```

Then:

```bash
cp .env.example .env                      # S5 only: the model key
cp contracts/.env.example contracts/.env  # this is the authoritative one
# fill in the four private keys the faucet funded, in contracts/.env
```

**Which `.env` is which.** `contracts/.env` is the authoritative one — every
script reads it by explicit path (`g6.ts`, `explorer.ts`, `seller-check.ts`,
`three-light/setup.ts`). The root `.env` holds only the S5 model key and is read
by S5 alone. Neither is in git; `.gitignore:16` covers both. Private keys live
only in `contracts/.env`.

### Produce the evidence pair

```bash
cd packages/authority-header
pnpm g6 within    # redeems 0.1 WMON under a 0.5 cap
pnpm g6 over      # attempts 0.8 WMON, reverts on chain
```

`pnpm g6` refuses to send a redemption when the agent cannot pay for it, and
estimates fees rather than pinning them. The old 20 gwei pin was below the
network's base fee and the script could not run at all.

### Watch the agent limit itself

```bash
# needs GEMINI_API_KEY in the root .env
cd packages/authority-header
pnpm s5
```

Five runs at temperature 0. Each one reads the agent's own cap through the
seller's verification path, asks the model which resource it will buy, executes
that choice on chain, and separately attempts the premium tier so the record
contains the revert too. Writes `working/s5-runs.json`.

### Watch a transaction reach finality

```bash
cd packages/three-light
pnpm watch 0x8c3f365859ab4a78de9b4bd26b9cbdb0cf6d37f01412022a5df369d41f6c3b00
```

Follows one transaction through all four commit states on the live
`monadNewHeads` socket. The socket is opened *before* the transaction is watched,
because `Proposed` exists for a few hundred milliseconds and polling cannot
recover it.

### See who authorised what

```bash
cd packages/authority-header
pnpm explorer table
pnpm explorer lineage 0x7599f34b7c832e8c70027b9f0745091ae8a873d7608b1d24d7e66051f98ee0a2
pnpm explorer scene    # registers a two-hop chain, revokes the parent, checks the child dies
```

### Run the seller

```bash
cd packages/authority-header
pnpm seller-check       # measured gate: 402 / 425 / 403 / 403 / 403, under 1s
```

`start:seller` needs `contracts/.env` exported into the environment first. The
seller reads `process.env`, not a file, so running it bare gives it
`SELLER_ADDRESS = 0x0000…` and every check fails:

```bash
cd packages/authority-header
set -a && . ../../contracts/.env && set +a
pnpm start:seller
```

`seller-check` does not need this: it parses `contracts/.env` itself and passes
the values to the seller it spawns.

---

## Layout

```
packages/protocol/         wire formats, terms encoding, chain decoder  <- single source of truth
packages/envelope-cli/     SKILL.md -> delegations with caveats
packages/three-light/      monadNewHeads client, commitState index, release policy
packages/authority-header/ seller, authority verification, G6 + explorer scripts
contracts/                 AuthorityRegistry, SkillAuthorityEnforcer, tests
frontend/                  minimal chain-reading shell
```

`@mandat/protocol` is the only place the terms encoding is written down. The
contract, the CLI, the seller, and the tests all agree because they all import
it — not because four implementations were kept in sync.

---

## Limitations, stated plainly

**Revocation is enforced by the path it demonstrates.** The root delegator is a
`MultiSigDeleGator`, so `revokeDelegation` (which requires
`msg.sender == delegator`) cannot be called from an EOA. It is reached by
redeeming a delegation whose target is the registry — the same `redeemDelegations`
mechanism the demo uses to spend. That is the mechanism DTK intends for a
contract delegator, and it is worth stating rather than presenting revocation as
an independent mechanism.

**DTK's `disabledDelegations` is not our revocation.** DTK has its own list and
checks it per hop. Our registry never writes to it. What we enforce is
`revokedAt` in `AuthorityRegistry`, read by our own enforcer. A delegator can
call DTK's `disableDelegation` directly; we do not.

**ERC-8004 is absent on testnet.** `bindAgent` is used, which asserts an agent id
without an identity-registry check. On mainnet `bindAgentFromERC8004` is the real
path, and it requires the live Identity Registry.

**EIP-7702 delegation does not apply on Monad testnet.** Transactions of type
`0x04` are accepted, but `eth_getCode` on the delegated account stays `0x`: the
state delegation is not applied. The root is therefore a deployed
`MultiSigDeleGator` rather than a 7702-authorised EOA. Detecting this is what
`three-light setup verify` exists for, and it fails loudly rather than reporting
success.

**On-chain cannot compare a child's cap with its parent's.** Solidity cannot read
the parent's cap and compare numbers across a mapping. What is on-chain is: the
parent is not revoked. The numeric comparison happens in the compiler and in the
seller, both off-chain and both recomputed from the caveats rather than trusted
from the header.

**Payment is verified; a real x402 settlement is not recorded.** The seller checks
that the settlement transaction transferred the right token and amount to its
address, and requires the facilitator's `/verify` to attest. No payment has been
made through the live facilitator yet. There is also no USDC on testnet, so the
demo settles in WMON.

---

## AI disclosure

**S5 — the self-limiting agent — runs on Google Gemini (`gemini-3.8-flash`,
temperature 0).** The original design in `working/prd.md` specified
`qwen3.8-max`; it was changed to Gemini on resource grounds. Nothing in S5
depends on which model is used: what it demonstrates is an agent reading its own
cap from an Authority Header and deciding accordingly.

The prompt shows the price of each tier and the model's task, but **never states
the agent's budget** — that arrives only from the chain, through the same
verification a seller would run. Without that, "the agent read its cap and
downgraded" would not be a claim anything could falsify. An earlier version of
the prompt also omitted prices, which made every run attempt the premium tier;
that was a broken prompt, not a broken constraint, and it is described in
`contracts/deployments.md`.

The rest of the codebase — contracts, envelope compiler, seller, Three-Light,
G6, explorer — is not model-generated in its design; it was written against the
DTK v1.3.0 source and verified against the deployed contracts. Where a fact was
taken from documentation or another source rather than verified on chain, it says
so.

---

## Pre-existing components

Not written here, used as-is:

- [delegation-framework](https://github.com/monad-labs/delegation-framework) v1.3.0 — DTK, delegation manager, ERC-1271
- [erc-8004-contracts](https://github.com/monad-labs/erc-8004-contracts) — agent identity
- [openzeppelin-contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) v5.4.0
- [x402](https://github.com/coinbase/x402) — payment protocol and facilitator
- Monad testnet — `commitState`, on the WebSocket feed only

---

## Licence

MIT. See [LICENSE](LICENSE).