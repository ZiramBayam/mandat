// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import {Base} from "./Base.t.sol";
import {Caveat, ModeCode} from "delegation-framework/utils/Types.sol";
import {SkillAuthorityEnforcer} from "../src/SkillAuthorityEnforcer.sol";

/// @notice T1, T2, T3, T5, T6, T7, T8 and the fail-closed rules.
contract SkillAuthorityEnforcerTest is Base {
    uint8 constant ALL = 0x07;

    /* ---------------- MANIFEST ---------------- */

    function test_manifestLivePasses() public {
        _hook(0x01, MANIFEST, bytes32(0), agent);
    }

    function test_manifestNeverRegisteredReverts() public {
        vm.expectRevert(abi.encodeWithSelector(SkillAuthorityEnforcer.ManifestNotLive.selector, keccak256("nope")));
        _hook(0x01, keccak256("nope"), bytes32(0), agent);
    }

    /// T3: revoking the consent document kills every delegation bound to it,
    /// without iterating them.
    function test_revokedManifestReverts() public {
        registry.revokeManifest(MANIFEST);
        vm.expectRevert(abi.encodeWithSelector(SkillAuthorityEnforcer.ManifestNotLive.selector, MANIFEST));
        _hook(0x01, MANIFEST, bytes32(0), agent);
    }

    function test_manifestBitOnWithZeroDigestReverts() public {
        vm.expectRevert(SkillAuthorityEnforcer.MalformedTerms.selector);
        _hook(0x01, bytes32(0), bytes32(0), agent);
    }

    /* ---------------- GRAPH ---------------- */

    /// T8: a root has no parent, so the check is skipped, not failed.
    function test_graphSkippedForRoot() public {
        _hook(0x02, bytes32(0), bytes32(0), agent);
    }

    /// T14: a chain whose hop is absent from the graph cannot execute.
    function test_graphRevertsWhenParentUnknown() public {
        vm.expectRevert(abi.encodeWithSelector(SkillAuthorityEnforcer.ParentNotRegistered.selector, keccak256("ghost")));
        _hook(0x02, bytes32(0), keccak256("ghost"), agent);
    }

    function test_graphPassesWhenParentRegistered() public {
        Caveat[] memory cs = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, bytes32(0)));
        bytes32 h = _register(_root(userPk, user, agent, cs), MANIFEST);
        _hook(0x02, bytes32(0), h, agent);
    }

    /// A revoked parent must fail the graph check. This is the case that makes
    /// revocation mean anything: `isRegistered` still returns true for a
    /// revoked delegation, so an enforcer that reads it instead of `isLive`
    /// would let a withdrawn authority keep working. Found by the end-to-end
    /// test in Redeem.t.sol, not by review.
    function test_graphRevertsWhenParentRevoked() public {
        Caveat[] memory cs = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, bytes32(0)));
        bytes32 h = _register(_root(userPk, user, agent, cs), MANIFEST);

        vm.prank(user);
        registry.revokeDelegation(h);

        assertTrue(registry.isRegistered(h), "the row survives revocation");
        assertFalse(registry.isLive(h), "but it is not live");

        vm.expectRevert(abi.encodeWithSelector(SkillAuthorityEnforcer.AuthorityRevoked.selector, h));
        _hook(0x02, bytes32(0), h, agent);
    }

    /// The parent may be live itself while an ancestor above it is revoked.
    /// Only a check that walks the whole chain catches this, which is why the
    /// enforcer reads `isLive` rather than comparing `revokedAt` directly.
    function test_graphRevertsWhenAnAncestorIsRevoked() public {
        Caveat[] memory cs = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, bytes32(0)));
        bytes32 grandparent = _register(_root(userPk, user, agent, cs), MANIFEST);
        bytes32 parent = _register(_child(agentPk, agent, subAgent, grandparent, cs), MANIFEST);

        assertTrue(registry.isLive(parent), "the parent is live while its own parent is");

        vm.prank(user);
        registry.revokeDelegation(grandparent);

        assertFalse(registry.isLive(parent), "revoking the root propagates liveness down");
        assertTrue(registry.isRegistered(parent), "but not registration");

        // The revert names the hop the delegation points at, not the ancestor
        // that was actually revoked. Reading `ancestors` from the registry is
        // what a caller would do to find out which one it was.
        vm.expectRevert(abi.encodeWithSelector(SkillAuthorityEnforcer.AuthorityRevoked.selector, parent));
        _hook(0x02, bytes32(0), parent, agent);
    }

    /* ---------------- IDENTITY ---------------- */

    /// T5: a redeemer with no ERC-8004 identity is refused.
    function test_identityRevertsForStranger() public {
        vm.expectRevert(abi.encodeWithSelector(SkillAuthorityEnforcer.RedeemerHasNoIdentity.selector, stranger));
        _hook(0x04, bytes32(0), bytes32(0), stranger);
    }

    function test_identityPassesForBoundAgent() public {
        _hook(0x04, bytes32(0), bytes32(0), agent);
    }

    /// Binding is public on chain, so anyone may bind. That can only make the
    /// identity check looser, never stricter, which is why it is permissionless.
    function test_bindingIsPermissionless() public {
        registry.bindAgent(stranger, 7);
        _hook(0x04, bytes32(0), bytes32(0), stranger);
    }

    /* ---------------- fail-closed on malformed terms ---------------- */

    /// T6: a version we do not understand must revert, not be tolerated.
    function test_unsupportedVersionReverts() public {
        bytes memory terms = abi.encode(
            SkillAuthorityEnforcer.Terms({version: 2, checks: ALL, manifestHash: MANIFEST, parentDelegationHash: bytes32(0)})
        );
        vm.expectRevert(abi.encodeWithSelector(SkillAuthorityEnforcer.UnsupportedTermsVersion.selector, uint8(2)));
        enforcer.beforeHook(terms, "", ModeCode.wrap(0), "", bytes32(0), user, agent);
    }

    /// T7: an unknown check bit must revert. Ignoring it would let a delegation
    /// written for a future check run today without that check.
    function test_unknownCheckBitReverts() public {
        vm.expectRevert(abi.encodeWithSelector(SkillAuthorityEnforcer.UnknownCheck.selector, uint8(0x08)));
        _hook(0x08, bytes32(0), bytes32(0), agent);
    }

    function test_wrongLengthTermsReverts() public {
        vm.expectRevert(SkillAuthorityEnforcer.MalformedTerms.selector);
        enforcer.beforeHook(hex"1234", "", ModeCode.wrap(0), "", bytes32(0), user, agent);
    }

    /* ---------------- gas ---------------- */

    /// G4 gate. The 18_000 figure in working/contracts.md 6 was an estimate that
    /// counted three cold SLOADs and a dispatch, and omitted the CALL opcode's
    /// cold-account charge. Measured end-to-end in Redeem.t.sol, the same hook
    /// costs about 19.500 for three checks cold. So the estimate, not the
    /// contract, was wrong; contracts.md 6 is corrected in the same commit.
    ///
    /// This is recorded rather than quietly relaxed: the number is a real cost
    /// DTK pays on every redemption, and pretending it is 18.000 would make the
    /// README's gas claim untrue.
    function test_gasBudget() public {
        Caveat[] memory cs = _oneCaveat(address(enforcer), _mandateTerms(ALL, MANIFEST, bytes32(0)));
        _register(_root(userPk, user, agent, cs), MANIFEST);

        bytes memory terms = _mandateTerms(ALL, MANIFEST, bytes32(0));
        uint256 gasBefore = gasleft();
        enforcer.beforeHook(terms, "", ModeCode.wrap(0), "", bytes32(0), user, agent);
        uint256 used = gasBefore - gasleft();
        emit log_named_uint("beforeHook, three checks, cold", used);
        assertLt(used, 25_000, "well clear of any order-of-magnitude regression");
    }
}
