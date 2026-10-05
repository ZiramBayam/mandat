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

    /// T8: a root has no parent, so that part is skipped rather than failed. The
    /// delegation itself is still checked, which is the point.
    function test_graphPassesForARegisteredRoot() public {
        Caveat[] memory cs = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, bytes32(0)));
        bytes32 h = _register(_root(userPk, user, agent, cs), MANIFEST);
        _hookFor(0x02, bytes32(0), bytes32(0), h, agent);
    }

    /// T14: a hop absent from the graph cannot execute.
    function test_graphRevertsWhenParentUnknown() public {
        Caveat[] memory cs = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, bytes32(0)));
        bytes32 h = _register(_root(userPk, user, agent, cs), MANIFEST);
        vm.expectRevert(abi.encodeWithSelector(SkillAuthorityEnforcer.ParentNotRegistered.selector, keccak256("ghost")));
        _hookFor(0x02, bytes32(0), keccak256("ghost"), h, agent);
    }

    /**
     * The delegation itself must be in the graph. This is the case that made
     * revocation decorative: a root delegation has no parent, so an enforcer that
     * only read `parentDelegationHash` never checked the root at all, and a
     * revoked root went on redeeming. Found by running the live G6 flow, not by
     * reading the contract.
     */
    function test_graphRevertsWhenTheDelegationItselfIsUnknown() public {
        vm.expectRevert(abi.encodeWithSelector(SkillAuthorityEnforcer.NotInGraph.selector, keccak256("nope")));
        _hookFor(0x02, bytes32(0), bytes32(0), keccak256("nope"), agent);
    }

    /**
     * A revoked ROOT must stop working. Without this the chain keeps
     * redeeming after `revokeDelegation`, which is the opposite of what the
     * registry is for.
     */
    function test_graphRevertsWhenTheRootItselfIsRevoked() public {
        Caveat[] memory cs = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, bytes32(0)));
        bytes32 h = _register(_root(userPk, user, agent, cs), MANIFEST);

        _hookFor(0x02, bytes32(0), bytes32(0), h, agent);

        vm.prank(user);
        registry.revokeDelegation(h);

        vm.expectRevert(abi.encodeWithSelector(SkillAuthorityEnforcer.AuthorityRevoked.selector, h));
        _hookFor(0x02, bytes32(0), bytes32(0), h, agent);
    }

    function test_graphPassesWhenParentRegistered() public {
        Caveat[] memory cs = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, bytes32(0)));
        bytes32 parentHash = _register(_root(userPk, user, agent, cs), MANIFEST);
        bytes32 childHash = _register(_child(agentPk, agent, subAgent, parentHash, cs), MANIFEST);
        _hookFor(0x02, bytes32(0), parentHash, childHash, agent);
    }

    /// A revoked parent must fail the graph check. This is the case that makes
    /// revocation mean anything: `isRegistered` still returns true for a
    /// revoked delegation, so an enforcer that reads it instead of `isLive`
    /// would let a withdrawn authority keep working. Found by the end-to-end
    /// test in Redeem.t.sol, not by review.
    function test_graphRevertsWhenParentRevoked() public {
        Caveat[] memory cs = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, bytes32(0)));
        bytes32 parentHash = _register(_root(userPk, user, agent, cs), MANIFEST);
        bytes32 childHash = _register(_child(agentPk, agent, subAgent, parentHash, cs), MANIFEST);

        _hookFor(0x02, bytes32(0), parentHash, childHash, agent);

        vm.prank(user);
        registry.revokeDelegation(parentHash);


        assertTrue(registry.isRegistered(parentHash), "the row survives revocation");
        assertFalse(registry.isLive(parentHash), "but it is not live");

        // Revoking the parent makes the child not live, because `isLive` walks
        // upward. So the delegation's own check is what fires first, and the
        // revert names the child rather than the revoked parent.
        vm.expectRevert(abi.encodeWithSelector(SkillAuthorityEnforcer.AuthorityRevoked.selector, childHash));
        _hookFor(0x02, bytes32(0), parentHash, childHash, agent);
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

        // The revert names the delegation being redeemed, not the ancestor that
        // was actually revoked. A caller that wants to know which ancestor went
        // away walks the registry's own lineage view.
        vm.expectRevert(abi.encodeWithSelector(SkillAuthorityEnforcer.AuthorityRevoked.selector, parent));
        _hookFor(0x02, bytes32(0), parent, parent, agent);
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
        bytes32 h = _register(_root(userPk, user, agent, cs), MANIFEST);

        bytes memory terms = _mandateTerms(ALL, MANIFEST, bytes32(0));
        uint256 gasBefore = gasleft();
        enforcer.beforeHook(terms, "", ModeCode.wrap(0), "", h, user, agent);
        uint256 used = gasBefore - gasleft();
        emit log_named_uint("beforeHook, three checks, cold", used);
        assertLt(used, 25_000, "well clear of any order-of-magnitude regression");
    }
}
