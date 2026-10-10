# Deployments

Every address and tx hash below was read back from Monad testnet after the
broadcast, not copied from the script's own output. Reproduction commands:
`working/constraints.md` §10.

## Monad testnet, chain 10143

### Contracts we deployed

Re-deployed 5 Okt 2026 after the graph-check fix described below. The previous
pair is kept in git history, not here: nothing live depended on it.

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| `AuthorityRegistry` | `0xb51807EC9C8090c155E80B085ebdD999CCf68D30` | `0xeb151e6021d2202842376ae7c1ffa5bf2c6a57211c19b28a626218562d69411a` | 68374949 |
| `SkillAuthorityEnforcer` | `0x5c6EE4586ACABcb6326069c229E58091B21ef384` | `0x0bb895b6cee835d3b4ccc34e8323de45f0837358f75c110a3958c42542904768` | 68374957 |
| `MultiSigDeleGator` (impl) | `0x29aCEbb657889507f3960CBEB959e0f8247539d1` | `0x3d47175fe5550b258936c89b813b6eb109c430b2bd7fb417cb0a781b91c87d2b` | 68363175 |
| Root proxy (the root delegator) | `0xDf9E68Bee379A298709aeb94072d1b1b9A333921` | `0xbc0f39b39d72cbc382271b3d6f8e9a309159b9b411cc0ea86a01c71f67d4b183` | 68363183 |

Re-deployed a third time on 5 Okt 2026 after terms v2 added `allowedSeller`, so
the addresses above are the current ones. Earlier pairs are in git history.

The deploy transactions and block numbers were recovered by binary-searching
`eth_getCode` for each contract's first block, not read from the forge broadcast
files. Those files record only the last run, and two of the hashes previously
listed here belonged to the *second* deployment pair — the same class of stale
evidence the G6 section below had to be corrected for.

Verified after deployment, read via `eth_call`:

```
AuthorityRegistry.DELEGATION_MANAGER() = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
AuthorityRegistry.ROOT_AUTHORITY()     = 0xffff...ffff
AuthorityRegistry.ERC8004_IDENTITY()   = 0x0000...0000   (expected: none on testnet)
SkillAuthorityEnforcer.REGISTRY()      = 0xb51807EC9C8090c155E80B085ebdD999CCf68D30
SkillAuthorityEnforcer.TERMS_VERSION() = 2
SkillAuthorityEnforcer.TERMS_LENGTH()  = 160
SkillAuthorityEnforcer.CHECK_MASK()    = 7
```

`ERC8004_IDENTITY` is zero on purpose. The `IDENTITY` check reads
`AuthorityRegistry.agentIdOf`, never the ERC-8004 contract. See
`working/constraints.md` §3.2 for why we are not deploying a registry to
testnet.

### Root delegator

The user-facing root delegator for the demo. A `MultiSigDeleGator` behind an
ERC-1967 proxy, signer = the user's EOA, threshold 1.

| | Address | Deploy tx |
|---|---|---|
| Implementation | `0x29aCEbb657889507f3960CBEB959e0f8247539d1` | `0x3d47175fe5550b258936c89b813b6eb109c430b2bd7fb417cb0a781b91c87d2b` |
| **Root delegator** | `0xDf9E68Bee379A298709aeb94072d1b1b9A333921` | `0xbc0f39b39d72cbc382271b3d6f8e9a309159b9b411cc0ea86a01c71f67d4b183` |

Verified on chain: `NAME()` = `"MultiSigDeleGator"`, `VERSION()` = `"1.3.0"`,
`isSigner(user)` = `true`, `delegationManager()` = DTK's manager.

**Why not the EOA.** The intended shape was one passkey, one EOA,
7702-delegated. Monad testnet accepts a type `0x04` transaction, includes it
with status success and charges 46.382 gas for it, but never stores the
delegation: `eth_getCode` on the account stays `0x` in every block, `VERSION()`
returns nothing, and the account can still send plain transfers. The
authorization transaction is `0xb60abd57e446c0344b163f08389e872b8b369e032d916fc659fb539773ef9c47`.
Full evidence in `working/constraints.md` §11, tracked as OPEN-04.

`redeemDelegations` executes through
`IDeleGatorCore(rootDelegator).executeFromExecutor`, so the root delegator must
carry code. A contract delegator is verified over ERC-1271, which
`AuthorityRegistry.sol:112-115` already supported.

### Caveat enforcers

Deployed 26 Sep 2026, chain 10143. MetaMask publishes `AllowedTargets`,
`AllowedMethods` and `ERC20PeriodTransfer` at the same addresses on both chains;
the last two are ours, because DTK's CREATE2 salt is not published and their
addresses cannot be derived.

| Enforcer | Address | Source |
|---|---|---|
| `AllowedTargets` | `0xA3f6693F12eF86479472C1445893335359A793D9` | ours, parity with the live one asserted |
| `AllowedMethods` | `0x7cF10cEAddEe52019F123822C432481E1FD311b5` | ours, parity with the live one asserted |
| `ERC20PeriodTransfer` | `0x40CA8Ed973609be0A28d62805289B2451265005f` | ours, parity with the live one asserted |
| `Timestamp` | `0xEcee8037a4BaABD46f8D35c000bF7AF385CdE345` | ours, no live counterpart |
| `LimitedCalls` | `0xc713A1439D395C25eC41fAAcBF68bcA1ecd47041` | ours, no live counterpart |

Parity is asserted in `test/CaveatEnforcerParity.t.sol` by decoding identical
terms through the live enforcer and through ours, not by comparing bytecode.

## Seller decisions, measured

`packages/authority-header/scripts/seller-check.ts` starts the seller and drives
it, so the figures come from the running process rather than from a log line.

| Request | Result |
|---|---|
| No Authority Header | `402` with the x402 challenge |
| Cap inflated in the header | `403`, "claimed 800000000, recomputed 50000000" |
| Registered delegation, cheap tier, no payment | `425` withheld. **Previously `200`, the paid answer** |
| Registered delegation, expensive tier | `403`, "costs 800000000000000000 … above the cap of 500000000000000000" |
| Wrong chain | `403`, before any RPC |
| Latency, 5 warm runs | 133, 159, 205, 159, 179 ms. Worst **205 ms** against a 1000 ms budget |

The audit log held 10 signed records, with `auditHash` and `signature` present and
at least one denial among them.

## G6 — the two transactions the project exists to produce

Produced 5 Okt 2026 against the Terms v2 deployment below. Both read back from
chain. **The earlier pair recorded here was stale** and has been replaced; see
"Why this pair was re-recorded".

| | Tx | Result |
|---|---|---|
| Redeem **within** cap (0.1 of 0.5 WMON) | `0x8c3f365859ab4a78de9b4bd26b9cbdb0cf6d37f01412022a5df369d41f6c3b00` | **success**, block 69722745 |
| Redeem **over** cap (0.8 of 0.5 WMON) | `0x0a2c43451a899cefe9855998e5f6e6dac089b8a8b921b3832ed93b0dcced0e15` | **mined and reverted**, block 69723303, 900000 gas |

The over-cap transaction was **mined and reverted on chain**. That distinction is
the point: it is DTK's own enforcer rejecting the call after the transaction was
broadcast, not our script declining to send it and not our middleware answering
`403`. A reverted transaction has a block number and a gas cost; a middleware
refusal has neither.

The over-cap revert consumed the full 900k gas cap and moved nothing.

### Why this pair was re-recorded

The previous pair (`0x0c42158f…`, block 68368270) was recorded against a registry
that no longer exists. The current `AuthorityRegistry`
`0xb51807EC9C8090c155E80B085ebdD999CCf68D30` was deployed at block **68374949**,
6,679 blocks *after* that transaction. The Terms v2 change to
`SkillAuthorityEnforcer` also came after it. So the old evidence proved the
behaviour of a contract that is no longer deployed.

Found by binary-searching `eth_getCode` for the registry's deployment block and
comparing it to the recorded transaction's block, rather than by noticing. A
stale evidence pair in a document about evidence is worth the check.

Balances read back after both, not from the script's own log:

```
root delegator 0xDf9E68…  0.4 WMON   (0.5 before)
sub-agent       0xeDaeDE…  0.5 WMON   (0.4 before)
```

The successful transaction emitted a `Transfer` event from the root delegator to
the sub-agent for exactly 0.1 WMON. A redemption that moved no tokens would have
produced a receipt too, so the balance assertion is the evidence, and it is
asserted in `Redeem.t.sol::test_T13_successfulRedemptionMovesTheBalance` as well.

### Supporting transactions

| | Tx |
|---|---|
| Fund USER 1.5 MON | `0x618397f14a31d0f89d…` |
| Fund AGENT 0.4 MON | `0x3840f78c3730743a7c…` |
| Fund SUBAGENT 0.25 MON | `0x6c93a4e1d3c6970bde…` |
| Wrap 1 MON into WMON | `0x7e872315ae45df9afd3cc93b7c0a992049e0bf1aafffda9a6a4b23d3ae5a72dd` |
| WMON to root delegator | `0xdc67f8117cbdd90e510ce77c102dc2dcba047cbfa9421ca5cce0420d954bc8bf` |
| `registerManifest` | `0xe4e48d21d09ee6c6814954f28bbe3cc373800272478709dc74eb5df51d3bf29a` |
| `bindAgent(agent, 1042)` | `0x57fba8054b483bc401eb2256768a60c24ca7f10bf1ab85dadb5f4811c96202f4` |
| `bindAgent(sub-agent, 1043)` | `0xab63bf03e2df1c82466ec6242e754f7f9580d33083afcc5d38e42c0f72f8efd0` |
| `registerDelegation` | `0xcc155a71ec3e5e176e557867b1fc6fa02a06c682a344a4bba6e9b5ac4d0d4ac4` |

Delegation hash `0x3e3c33a03e52ec23d14aa678632c1f78aa47271b03000b9eb20cb7e8b0c09880`,
root authority `0xffff…ffff`, manifest `0xeb4c4e02…31cf6`.

The authority graph, read via `eth_call` with no server:

```
delegator    0xDf9E68…3921   (the contract root delegator)
delegate     0x2D5d77…75A2   (the agent EOA that paid gas)
agentId      1042
parentHash   0xffff…ffff     (root)
manifestHash 0xeb4c4e02…31cf6
lineage      depth 1
```

## Revocation, and the bug it exposed

`revokeDelegation` is `0xb02b77b5b7071455e9608a1d8a25e937bfedfdbc7808bedb82400481df5b7f0e`
(block 68368276). After it, `isRegistered` stayed `true` and `isLive` became
`false`, and the next redemption reverted.

Getting there took two fixes to `SkillAuthorityEnforcer`, both found by running
this flow rather than by reading the contract:

1. `GRAPH` read `isRegistered`, which cannot see `revokedAt`, so a revoked
   delegation still passed.
2. Even after switching to `isLive`, `GRAPH` only read
   `terms.parentDelegationHash`. A root has no parent, so the root itself was
   never checked, and a revoked root kept redeeming. This is what the live run
   caught.

`GRAPH` now checks the delegation being redeemed, using the `_delegationHash`
argument the hook already received and ignored, and its parent when there is
one. `NotInGraph`, `ParentNotRegistered` and `AuthorityRevoked` are distinct so a
revert says which thing happened.

**The limit worth stating.** DTK has `disabledDelegations` and checks it for
every hop including the root. That is DTK's list, and our registry never writes
to it. What we enforce is `revokedAt` in `AuthorityRegistry`, read by our own
enforcer. A delegator can additionally call DTK's `disableDelegation` directly;
we do not, and the README should not imply the two are the same mechanism.

## G9 — revoking a parent kills the subtree

`pnpm --filter @mandat/authority-header explorer scene` registers a two-hop chain,
revokes the parent, and checks the child. Three runs, all holding:

| Run | parent hash | child hash | revoke tx | result |
|---|---|---|---|---|
| 1 | `0xe4867eed…a45` | `0x95092a50…e7` | `0x16f489da…c7` | child `isLive false` |
| 2 | `0x9d7849af…2e` | `0x045af0b4…294` | `0xc56397c8…6f3` | child `isLive false` |
| 3 | `0x34da4847…17` | `0xc9b2b267…ed8` | `0x5ef13520…286` | child `isLive false` |

Full hashes for run 3: parent `0x34da48477a5bc5f23904db35513b33f9a2511801de815615c0ab515030da0317`,
child `0xc9b2b26724e4e55a12d06d70dbc4d8234cee1e2d187055996083a0d49c271ed8`,
revoke `0x5ef13520aa5f80d1e6413d068ea82d5e9ac7e0d869066ec50d4418ca07d88286`.
Registration txs for the same run: `0x8988189639c80ce52bf86faef348aa2b7c3c3a7a8081da6d4ea7a2a7924e058f`
and `0x52b061bcaf883fc8153a88dcb70279a027c046acc6a4fd17a96b6c29b0a7a445`.

In every run, after the parent's revoke: `isRegistered` stayed `true` on both
rows, `isLive` was `false` on both, redeeming the two-hop chain reverted, and the
root's WMON balance did not move.

**Why the scene builds its own chain.** The delegations `g6.ts` registers are one
hop deep, so `_revokeSubtree` had nothing to recurse into and "it recurses" was an
argument rather than evidence. The scene registers a child under a fresh parent
and checks it. Grant authority and revoke authority sit with different parties
here — the parent is signed ERC-1271 by the root `MultiSigDeleGator`, the child by
the agent EOA — so the revocation has to reach across into a row it did not sign.

**Costs, measured.** Base fee was 100 gwei and the node's suggested max fee 122
gwei on 5 Oct 2026. Registration uses about 261k–278k gas, the revoke 900k (the
cap), so one `scene` run costs roughly 0.15 MON. All three demo accounts are now
below that, so `scene` will refuse until one is funded; it says so with the
balances rather than failing partway.

## Monad mainnet, chain 143

Not deployed. No MON budget, and gate G13 in `working/plan.md` §2 puts it after
the video is recorded. Same script, no changes needed: on mainnet
`resolveIdentityRegistry()` returns the live registry at
`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` instead of zero, so
`bindAgentFromERC8004` becomes the real path.

## Redeploy

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url https://testnet-rpc.monad.xyz --broadcast
forge script script/DeployRootDeleGator.s.sol:DeployRootDeleGator \
  --rpc-url https://testnet-rpc.monad.xyz --broadcast
```

## Compiled envelope

`fixtures/wmon-spend/compiled.json` is generated from `SKILL.md` and regenerated
with:

```bash
cd packages/envelope-cli
set -a && . ../../contracts/.env && set +a
pnpm envelope compile ../../contracts/fixtures/wmon-spend/SKILL.md \
                      ../../contracts/fixtures/wmon-spend/compiled.json
```

`ENVELOPE_NOW` in `contracts/.env` pins the timestamp, so the output is
reproducible and the recorded demo matches the committed file. It must be set to
a time at or before the recording, because `ERC20PeriodTransfer` rejects a
`startDate` in the future and `Timestamp` rejects an expiry in the past.
