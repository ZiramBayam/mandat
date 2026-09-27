# Deployments

Every address and tx hash below was read back from Monad testnet after the
broadcast. Reproduction commands: `working/constraints.md` §10.

## Monad testnet, chain 10143

Deployed 26 Sep 2026 from `0xfa5AF5BAeB4aC500267D7189fa1f0AA923eCA894` (nonce 43).

| Contract | Address | Deploy tx |
|---|---|---|
| `AuthorityRegistry` | `0x7B091E437dC1C211f342aaf776dbDEaB3Cc95e9B` | `0x332eba23e319309340013f0bf04ee02a062734080d651f4911bc0ee824f72cf0` |
| `SkillAuthorityEnforcer` | `0xcEe98eFA34122dDB19C11B96FB638785d3738a4c` | `0x6c21b7f7402ced4e735bb66592dac56ee6f4e2ee0a16615449036bc80dbe659c` |

Verified after deployment:

```
AuthorityRegistry.DELEGATION_MANAGER() = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
AuthorityRegistry.ROOT_AUTHORITY()     = 0xffff...ffff
AuthorityRegistry.ERC8004_IDENTITY()   = 0x0000...0000   (expected: none on testnet)
AuthorityRegistry.delegationCount()    = 0
SkillAuthorityEnforcer.REGISTRY()      = 0x7B091E437dC1C211f342aaf776dbDEaB3Cc95e9B
SkillAuthorityEnforcer.TERMS_VERSION() = 1
SkillAuthorityEnforcer.CHECK_MASK()    = 7
```

`ERC8004_IDENTITY` is zero on purpose. The `IDENTITY` check reads
`AuthorityRegistry.agentIdOf`, never the ERC-8004 contract. See
`working/constraints.md` §3.2 for why we are not deploying a registry to
testnet.

## Monad mainnet, chain 143

Not yet deployed. Scheduled as gate G13 in `working/plan.md` §2, after the video
is recorded. Same script, no changes needed: on mainnet
`resolveIdentityRegistry()` returns the live registry at
`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` instead of zero, so
`bindAgentFromERC8004` becomes the real path.

## Redeploy

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url https://testnet-rpc.monad.xyz --broadcast
```

## Caveat enforcers

Deployed 26 Sep 2026, chain 10143. The first three are MetaMask's own and live at
the same addresses on both chains; the last two are ours, because DTK's CREATE2
salt is not published and their addresses cannot be derived.

| Enforcer | Address | Source |
|---|---|---|
| `AllowedTargets` | `0xA3f6693F12eF86479472C1445893335359A793D9` | ours, parity with `0x7F20f61b…` asserted |
| `AllowedMethods` | `0x7cF10cEAddEe52019F123822C432481E1FD311b5` | ours, parity with `0x2c21fD0C…` asserted |
| `ERC20PeriodTransfer` | `0x40CA8Ed973609be0A28d62805289B2451265005f` | ours, parity with `0x474e3Ae7…` asserted |
| `Timestamp` | `0xEcee8037a4BaABD46f8D35c000bF7AF385CdE345` | ours, no live counterpart |
| `LimitedCalls` | `0xc713A1439D395C25eC41fAAcBF68bcA1ecd47041` | ours, no live counterpart |

Parity is asserted in `test/CaveatEnforcerParity.t.sol` by decoding identical
terms through the live enforcer and through ours, not by comparing bytecode.

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
reproducible and the recorded demo matches the committed file.
