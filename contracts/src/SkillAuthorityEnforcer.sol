// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import {ICaveatEnforcer} from "delegation-framework/interfaces/ICaveatEnforcer.sol";
import {ModeCode} from "delegation-framework/utils/Types.sol";
import {AuthorityRegistry} from "./AuthorityRegistry.sol";

/// @notice One enforcer, three checks, chosen by a bitmask in `terms`.
/// @dev A single contract rather than three, so there is one address to allowlist,
///      one cold-SLOAD set per redemption, and one thing to audit. `terms` is
///      versioned, so checks can be added later without invalidating live delegations.
///
///      All three checks are things DTK does not do:
///        MANIFEST - binds the delegation to a published, revocable consent document.
///        GRAPH    - requires the parent hop to exist in the authority registry.
///        IDENTITY - requires the redeemer to hold an ERC-8004 agent id.
///
///      DTK already checks per-hop revocation, parent linkage and signatures. We do
///      not repeat those and we do not present them as ours. See working/constraints.md 4.3.
contract SkillAuthorityEnforcer is ICaveatEnforcer {
    /**
     * @dev Version 2 added `allowedSeller`.
     *
     *      Version 1 had no seller anywhere in `terms`, which made the seller's
     *      scoping check unverifiable: `checkSellerAndExpiry` compared a value
     *      the client itself asserted against the address being called. That is a
     *      self-comparison, not a check. With the seller in `terms` the seller
     *      reads it back out of the delegation and compares that, so a delegation
     *      minted for one seller cannot be presented to another.
     *
     *      Terms are versioned precisely so a change like this does not have to
     *      reinterpret delegations that are already live: a v1 delegation is
     *      rejected by `UnsupportedTermsVersion` rather than read as a v2 with an
     *      unset seller.
     */
    struct Terms {
        uint8 version;
        uint8 checks;
        bytes32 manifestHash;
        bytes32 parentDelegationHash;
        /** Zero means "any seller". Compared, never assumed. */
        address allowedSeller;
    }

    uint8 public constant TERMS_VERSION = 2;

    uint8 public constant CHECK_MANIFEST = 0x01;
    uint8 public constant CHECK_GRAPH = 0x02;
    uint8 public constant CHECK_IDENTITY = 0x04;
    uint8 public constant CHECK_MASK = 0x07;

    AuthorityRegistry public immutable REGISTRY;

    error UnsupportedTermsVersion(uint8 version);
    error SellerNotAllowed(address allowedSeller, address actual);
    error UnknownCheck(uint8 checks);
    error ManifestNotLive(bytes32 manifestHash);
    error ParentNotRegistered(bytes32 parentDelegationHash);
    /// @dev The hop this check was pointed at, or one of its ancestors, is in the
    ///      graph but revoked. Reported separately from ParentNotRegistered and
    ///      from NotInGraph because the three mean different things to whoever
    ///      holds the delegation: a wiring mistake, a withdrawal, and a delegation
    ///      we have never seen.
    error AuthorityRevoked(bytes32 delegationHash);
    /// @dev The delegation itself was never registered in the graph. Distinct
    ///      from ParentNotRegistered: this is about the hop being checked, not
    ///      about its parent.
    error NotInGraph(bytes32 delegationHash);
    error RedeemerHasNoIdentity(address redeemer);
    error MalformedTerms();

    constructor(AuthorityRegistry registry) {
        REGISTRY = registry;
    }

    /// @dev The fifth argument, named `_delegationHash` in the interface, is the
    ///      hash of the delegation being redeemed. The graph check reads it
    ///      directly: a root delegation has no parent, so checking only
    ///      `terms.parentDelegationHash` would leave the root unchecked, and a
    ///      revoked root would go on redeeming.
    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32 delegationHash,
        address,
        address redeemer
    ) external view override {
        Terms memory t = _decode(terms);

        if (t.version != TERMS_VERSION) revert UnsupportedTermsVersion(t.version);
        // Fail-closed on unknown bits. Ignoring them would mean a delegation written
        // for a future check silently runs today without it.
        if (t.checks & ~CHECK_MASK != 0) revert UnknownCheck(t.checks);

        if (t.checks & CHECK_MANIFEST != 0) {
            if (t.manifestHash == bytes32(0)) revert MalformedTerms();
            if (!REGISTRY.liveManifests(t.manifestHash)) revert ManifestNotLive(t.manifestHash);
        }

        if (t.checks & CHECK_GRAPH != 0) {
            // Two things have to hold, and conflating them is how revocation
            // ends up decorative.
            //
            // First, the delegation itself must be in the graph and live. This is
            // the case a root-only check misses: a root delegation has no parent,
            // so reading only `parentDelegationHash` leaves the root unchecked
            // and a revoked root keeps spending. The delegation hash arrives in
            // the hook, so there is nothing to excuse.
            //
            // Second, its parent, when it has one, must be too. A root has none,
            // so that part is genuinely skipped rather than failed.
            //
            // `isLive`, never `isRegistered`: the latter only tests that a row
            // exists and cannot see `revokedAt`. `isLive` walks upward, so it also
            // catches an ancestor several hops up, which is what "withdrawing a
            // root withdraws everything below it" has to mean.
            //
            // DTK checks `disabledDelegations` for every hop including the root,
            // but that is DTK's own revocation list, which our registry never
            // writes to. Nobody else covers our rows, so this check has to.
            if (!REGISTRY.isRegistered(delegationHash)) revert NotInGraph(delegationHash);
            if (!REGISTRY.isLive(delegationHash)) revert AuthorityRevoked(delegationHash);

            bytes32 parent_ = t.parentDelegationHash;
            if (parent_ != bytes32(0)) {
                if (!REGISTRY.isRegistered(parent_)) revert ParentNotRegistered(parent_);
                if (!REGISTRY.isLive(parent_)) revert AuthorityRevoked(parent_);
            }
        }

        if (t.checks & CHECK_IDENTITY != 0 && REGISTRY.agentIdOf(redeemer) == 0) {
            revert RedeemerHasNoIdentity(redeemer);
        }

        // Seller scoping, always on in v2 rather than behind a bit. A zero seller
        // means "any seller", which is how an agent's own delegation, minted for
        // general use, stays usable; anything else is exclusive to that address.
        //
        // The seller is not msg.sender: a redemption is executed by the
        // DelegationManager on behalf of the root delegator, so the account that
        // ends up receiving a payment is not this one either. This check exists so
        // the *seller* can read the scope out of `terms` and refuse a request
        // from a delegation minted for someone else. On-chain it is a policy
        // statement, not an enforcement of who gets paid.
        //
        // That limitation is deliberate and stated in working/architecture.md 4.1:
        // `ICaveatEnforcer` receives no parent delegation and no calldata target
        // it can attribute a payment to, so "this delegation may only spend at
        // seller X" is not expressible here.
    }

    /// @notice The seller this delegation is scoped to, or zero for any seller.
    /// @dev A view so a seller can answer the question with one eth_call instead
    ///      of reading `terms` itself. Kept separate from `beforeHook` because a
    ///      hook reverts by contract and this must be able to say "not scoped to
    ///      me" without reverting the redemption.
    function allowedSellerOf(bytes calldata terms) external pure returns (address) {
        Terms memory t = _decode(terms);
        if (t.version != TERMS_VERSION) revert UnsupportedTermsVersion(t.version);
        return t.allowedSeller;
    }

    /**
     * @dev abi.encode of a static struct is one 32-byte word per field, whatever
     *      the field types: `uint8` is padded, not packed. Five fields, so 160
     *      bytes for v2.
     *
     *      The length is asserted before decoding because `abi.decode` on a short
     *      blob reverts without saying which field was short, and the exact byte
     *      count is what a caller needs to know.
     */
    function _decode(bytes calldata terms) private pure returns (Terms memory) {
        if (terms.length != TERMS_LENGTH) revert MalformedTerms();
        return abi.decode(terms, (Terms));
    }

    /// @notice Byte length of encoded terms: one word per struct field.
    uint256 public constant TERMS_LENGTH = 160;

    /* ------------------------------------------------------------------ */
    /* Hooks we do not use                                                  */
    /* ------------------------------------------------------------------ */

    /// @dev Nothing to do before the batch. All of our checks are per delegation and
    ///      do not depend on the other delegations in the batch, which also keeps the
    ///      check independent of batch ordering.
    function beforeAllHook(bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address)
        external
        pure
        override
    {}

    /// @dev We make no claim about execution having happened. ICaveatEnforcer itself
    ///      warns that a before hook is not proof the call ran; asserting otherwise
    ///      would be a claim we cannot back.
    function afterHook(bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address)
        external
        pure
        override
    {}

    function afterAllHook(bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address)
        external
        pure
        override
    {}
}
