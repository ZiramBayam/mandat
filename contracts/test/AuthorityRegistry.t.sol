// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import {Base} from "./Base.t.sol";
import {Caveat, Delegation} from "delegation-framework/utils/Types.sol";
import {AuthorityRegistry} from "../src/AuthorityRegistry.sol";

/// @notice T3, T4, T10, T11, T12, T15 for the registry.
contract AuthorityRegistryTest is Base {
    bytes32 internal ROOT;

    function setUp() public override {
        super.setUp();
        ROOT = dm.ROOT_AUTHORITY();
    }

    function _chain() internal returns (bytes32 rootHash, bytes32 childHash) {
        Caveat[] memory rc = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, bytes32(0)));
        rootHash = _register(_root(userPk, user, agent, rc), MANIFEST);

        Caveat[] memory cc = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, rootHash));
        childHash = _register(_child(agentPk, agent, subAgent, rootHash, cc), MANIFEST);
    }

    /* ---------------- registration is self-validating ---------------- */

    /// T15: a third party can submit a delegation they are not a party to. The
    ///      registry checks the signature, not the caller.
    function test_anyoneMaySubmit() public {
        Caveat[] memory cs = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, bytes32(0)));
        Delegation memory d = _root(userPk, user, agent, cs);

        vm.prank(stranger);
        registry.registerDelegation(d, MANIFEST);

        assertTrue(registry.isRegistered(dm.getDelegationHash(d)));
    }

    /// T12: a forged signature is rejected even though registration is open.
    function test_forgedSignatureRejected() public {
        Caveat[] memory cs = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, bytes32(0)));
        Delegation memory d = _root(agentPk, user, agent, cs); // signed by the wrong key

        vm.expectRevert(AuthorityRegistry.InvalidEOASignature.selector);
        registry.registerDelegation(d, MANIFEST);
    }

    function test_tamperedAfterSigningRejected() public {
        Caveat[] memory cs = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, bytes32(0)));
        Delegation memory d = _root(userPk, user, agent, cs);
        d.delegate = stranger; // swap the delegate after signing

        vm.expectRevert(AuthorityRegistry.InvalidEOASignature.selector);
        registry.registerDelegation(d, MANIFEST);
    }

    function test_doubleRegistrationRejected() public {
        Caveat[] memory cs = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, bytes32(0)));
        Delegation memory d = _root(userPk, user, agent, cs);
        _register(d, MANIFEST);

        // Same struct, so the same hash. A different salt would be a different
        // delegation and would be accepted, which is correct.
        vm.expectRevert(AuthorityRegistry.DelegationAlreadyRegistered.selector);
        registry.registerDelegation(d, MANIFEST);
    }

    function test_sameFieldsDifferentSaltIsADifferentDelegation() public {
        Caveat[] memory cs = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, bytes32(0)));
        Delegation memory a = _root(userPk, user, agent, cs);
        _register(a, MANIFEST);

        Delegation memory b = a;
        b.salt = 99;
        b.signature = _sign(b, userPk);
        _register(b, MANIFEST);

        assertEq(registry.delegationCount(), 2);
    }

    /// The graph is self-building: a child cannot be registered before its parent.
    function test_childBeforeParentRejected() public {
        // Build before expectRevert: constructing the delegation calls
        // getDelegationHash, and expectRevert only applies to the next call.
        Caveat[] memory cc = _oneCaveat(address(enforcer), _mandateTerms(0x07, MANIFEST, keccak256("ghost")));
        Delegation memory orphan = _child(userPk, user, agent, keccak256("ghost"), cc);

        vm.expectRevert(abi.encodeWithSelector(AuthorityRegistry.ParentNotRegistered.selector, keccak256("ghost")));
        registry.registerDelegation(orphan, MANIFEST);
    }

    /* ---------------- revocation cascades ---------------- */

    /// T4: revoking a root kills the whole subtree, in one call.
    function test_revokeCascadesToDescendants() public {
        (bytes32 rootHash, bytes32 childHash) = _chain();
        assertTrue(registry.isLive(childHash));

        vm.prank(user);
        registry.revokeDelegation(rootHash);

        assertEq(_revokedAt(rootHash), block.timestamp);
        assertEq(_revokedAt(childHash), block.timestamp);
        assertFalse(registry.isLive(rootHash));
        assertFalse(registry.isLive(childHash));
    }

    function test_revokeChildLeavesParentLive() public {
        (bytes32 rootHash, bytes32 childHash) = _chain();
        vm.prank(agent);
        registry.revokeDelegation(childHash);

        assertTrue(registry.isLive(rootHash));
        assertFalse(registry.isLive(childHash));
    }

    /// The public mapping returns a tuple, so field access needs a helper.
    function _revokedAt(bytes32 h) internal view returns (uint64) {
        (, , , , , , uint64 revokedAt) = registry.authorities(h);
        return revokedAt;
    }

    function test_onlyDelegatorMayRevoke() public {
        (bytes32 rootHash,) = _chain();
        vm.expectRevert(AuthorityRegistry.NotYourDelegation.selector);
        vm.prank(stranger);
        registry.revokeDelegation(rootHash);
    }

    function test_revokingTwiceReverts() public {
        (bytes32 rootHash,) = _chain();
        vm.prank(user);
        registry.revokeDelegation(rootHash);
        vm.expectRevert(AuthorityRegistry.AlreadyRevoked.selector);
        vm.prank(user);
        registry.revokeDelegation(rootHash);
    }

    function test_revokingUnknownReverts() public {
        vm.expectRevert(AuthorityRegistry.UnknownDelegation.selector);
        vm.prank(user);
        registry.revokeDelegation(keccak256("nothing"));
    }

    /* ---------------- lineage: the attribution answer ---------------- */

    /// T10: root to leaf, so a reader learns who authorised what, through whom.
    function test_lineageIsRootToLeaf() public {
        (bytes32 rootHash, bytes32 childHash) = _chain();
        AuthorityRegistry.AuthorityMeta[] memory chain = registry.lineage(childHash);

        assertEq(chain.length, 2);
        assertEq(chain[0].delegator, user);
        assertEq(chain[0].delegate, agent);
        assertEq(chain[0].parentHash, ROOT);
        assertEq(chain[1].delegator, agent);
        assertEq(chain[1].delegate, subAgent);
        assertEq(chain[1].parentHash, rootHash);
    }

    function test_lineageCarriesIdentityAndManifest() public {
        (, bytes32 childHash) = _chain();
        AuthorityRegistry.AuthorityMeta[] memory chain = registry.lineage(childHash);
        assertEq(chain[0].agentId, 1042);
        assertEq(chain[0].manifestHash, MANIFEST);
    }

    function test_lineageOfUnknownIsEmpty() public {
        AuthorityRegistry.AuthorityMeta[] memory chain = registry.lineage(keccak256("ghost"));
        assertEq(chain.length, 0);
    }

    function test_descendantsAreIndexed() public {
        (bytes32 rootHash, bytes32 childHash) = _chain();
        bytes32[] memory kids = registry.descendantsOf(rootHash);
        assertEq(kids.length, 1);
        assertEq(kids[0], childHash);
    }

    /* ---------------- manifests ---------------- */

    /// T11: the CID is documentation, not integrity. It cannot make a different
    ///      document authoritative, only name the one the digest already commits to.
    function test_cidIsNotAnIntegrityCheck() public {
        bytes32 other = keccak256("manifest-v2");
        registry.registerManifest(other, "bafybeidifferent");

        assertEq(registry.manifestCid(MANIFEST), "bafybeiexamplemanifest");
        assertEq(registry.manifestCid(other), "bafybeidifferent");
        // Swapping a CID leaves the digest, and therefore the authority, untouched.
        assertTrue(registry.liveManifests(MANIFEST));
    }

    function test_revokeManifestKillsRegistration() public {
        registry.revokeManifest(MANIFEST);
        assertFalse(registry.liveManifests(MANIFEST));
    }

    /* ---------------- counter ---------------- */

    function test_countTracksRegistrations() public {
        assertEq(registry.delegationCount(), 0);
        _chain();
        assertEq(registry.delegationCount(), 2);
    }
}
