// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import {Test} from "forge-std/Test.sol";
import {Delegation, Caveat} from "delegation-framework/utils/Types.sol";
import {DelegationManager} from "delegation-framework/DelegationManager.sol";
import {IDelegationManager} from "delegation-framework/interfaces/IDelegationManager.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AuthorityRegistry} from "../src/AuthorityRegistry.sol";
import {SkillAuthorityEnforcer} from "../src/SkillAuthorityEnforcer.sol";
import {ModeCode} from "delegation-framework/utils/Types.sol";

/// @notice Shared fixtures. Forks testnet so the caveat enforcers are the real ones.
abstract contract Base is Test {
    DelegationManager internal dm;
    AuthorityRegistry internal registry;
    SkillAuthorityEnforcer internal enforcer;

    // Addresses are derived from the keys, never from makeAddr: a signature is only
    // valid for the address that produced it, and mixing the two fails with
    // InvalidEOASignature in a way that looks like a hashing bug.
    address internal user;
    address internal agent;
    address internal subAgent;
    address internal stranger;

    uint256 internal userPk = 0xA11CE;
    uint256 internal agentPk = 0xB0B;
    uint256 internal subAgentPk = 0xCAFE;

    bytes32 internal constant MANIFEST = keccak256("manifest-v1");
    bytes32 internal constant CID_HASH = keccak256("cid-v1");

    function setUp() public virtual {
        vm.createSelectFork(vm.envOr("MONAD_TESTNET_RPC", string("https://testnet-rpc.monad.xyz")), vm.envOr("MONAD_FORK_BLOCK", uint256(65825199)));

        dm = DelegationManager(payable(0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3));
        // Zero: Monad testnet has no ERC-8004 Identity Registry (verified, working/constraints.md 3.2),
        // so tests exercise the no-registry path. The ERC-8004 path is covered by
        // test/ERC8004Binding.t.sol against a stub.
        registry = new AuthorityRegistry(address(dm), address(0));
        enforcer = new SkillAuthorityEnforcer(registry);

        user = vm.addr(userPk);
        agent = vm.addr(agentPk);
        subAgent = vm.addr(subAgentPk);
        stranger = makeAddr("stranger");
        vm.label(user, "user");
        vm.label(agent, "agent");
        vm.label(subAgent, "subAgent");
        vm.label(stranger, "stranger");

        registry.registerManifest(MANIFEST, "bafybeiexamplemanifest");
        registry.bindAgent(agent, 1042);
        registry.bindAgent(subAgent, 1043);
    }

    function _sign(Delegation memory d, uint256 pk) internal view returns (bytes memory) {
        bytes32 structHash = dm.getDelegationHash(d);
        bytes32 digest = MessageHashUtils.toTypedDataHash(dm.getDomainHash(), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _root(uint256 pk, address delegator_, address delegate_, Caveat[] memory caveats)
        internal
        view
        returns (Delegation memory d)
    {
        d = Delegation({
            delegate: delegate_,
            delegator: delegator_,
            authority: dm.ROOT_AUTHORITY(),
            caveats: caveats,
            salt: 1,
            signature: ""
        });
        d.signature = _sign(d, pk);
    }

    /// @param parentHash hash of the parent delegation, which is what links the chain.
    function _child(uint256 pk, address delegator_, address delegate_, bytes32 parentHash, Caveat[] memory caveats)
        internal
        view
        returns (Delegation memory d)
    {
        d = Delegation({
            delegate: delegate_,
            delegator: delegator_,
            authority: parentHash,
            caveats: caveats,
            salt: 2,
            signature: ""
        });
        d.signature = _sign(d, pk);
    }

    /// @notice Submit a delegation to the registry and return its hash.
    function _register(Delegation memory d, bytes32 manifestHash) internal returns (bytes32 h) {
        h = dm.getDelegationHash(d);
        registry.registerDelegation(d, manifestHash);
    }

    function _register(Delegation memory d) internal returns (bytes32) {
        return _register(d, MANIFEST);
    }

    function _mandateTerms(uint8 checks, bytes32 manifest, bytes32 parent) internal pure returns (bytes memory) {
        return abi.encode(SkillAuthorityEnforcer.Terms({version: 1, checks: checks, manifestHash: manifest, parentDelegationHash: parent}));
    }

    function _hook(uint8 checks, bytes32 manifest, bytes32 parent, address redeemer) internal view {
        enforcer.beforeHook(
            _mandateTerms(checks, manifest, parent),
            "",
            ModeCode.wrap(0),
            "",
            bytes32(0),
            user,
            redeemer
        );
    }

    function _oneCaveat(address enforcer_, bytes memory terms) internal pure returns (Caveat[] memory cs) {
        cs = new Caveat[](1);
        cs[0] = Caveat({enforcer: enforcer_, terms: terms, args: ""});
    }
}
