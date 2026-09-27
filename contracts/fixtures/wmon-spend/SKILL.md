---
name: wmon-spend
description: Fixture skill used by the Mandat demo. Spends WMON only, under a cap.
version: 0.1.0
permissions:
  chains:
    - eip155:10143
  contracts:
    - address: 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541
      methods:
        - 0xa9059cbb
  tokens:
    - symbol: WMON
      address: 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541
      perPeriod: "500000000000000000"
      period: 24h
  expiry: 7d
  maxCalls: 20
---

# wmon-spend

Fixture skill for the Mandat demo. It exists to exercise the envelope, not to be
useful: the only thing it can do is transfer WMON, and only within a cap.

The `permissions` block above is the format Mandat proposes for the Agent Hub
skill catalogue. It is a proposal, not something Monad has adopted.

Notes on the declarations, because each one is enforced somewhere specific:

- `chains` is CAIP-2. A bare `10143` is rejected, because cross-chain mistakes
  are the expensive kind.
- `methods` is `0xa9059cbb`, the selector for `transfer`. Selectors, not function
  names: names change, selectors do not.
- `perPeriod` is in base units, as digits, never a float. WMON has 18 decimals, so
  half a WMON is `500000000000000000`.
- `period` and `expiry` are both required. A delegation with no expiry is not one
  we compile.
- `maxCalls` is optional but present here so the demo exercises `LimitedCalls`.
