// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import {Test} from "forge-std/Test.sol";
import {AuthorityRegistry} from "../src/AuthorityRegistry.sol";
import {IERC8004Identity} from "../src/AuthorityRegistry.sol";

/// @dev Stands in for the ERC-8004 Identity Registry. Monad testnet has none, and
///      deploying the canonical one is not on the critical path, so the binding
///      path is tested against this instead. The interface used is only `ownerOf`,
///      which is all AuthorityRegistry ever calls.
contract StubIdentityRegistry {
    mapping(uint256 => address) internal _owner;
    uint256 internal _next = 1;

    function register() external returns (uint256 id) {
        id = _next++;
        _owner[id] = msg.sender;
    }

    function ownerOf(uint256 id) external view returns (address) {
        address o = _owner[id];
        require(o != address(0), "no such agent");
        return o;
    }
}

contract ERC8004BindingTest is Test {
    address constant DTK = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;

    StubIdentityRegistry internal erc8004;
    AuthorityRegistry internal withRegistry;
    AuthorityRegistry internal withoutRegistry;

    address internal alice = makeAddr("alice");
    address internal mallory = makeAddr("mallory");

    function setUp() public {
        // Forked because AuthorityRegistry's constructor reads ROOT_AUTHORITY from the
        // live DelegationManager and refuses to deploy against an address with no code.
        // That refusal is deliberate; the cost is that unit tests need a fork.
        vm.createSelectFork(
            vm.envOr("MONAD_TESTNET_RPC", string("https://testnet-rpc.monad.xyz")),
            vm.envOr("MONAD_FORK_BLOCK", uint256(65825199))
        );
        erc8004 = new StubIdentityRegistry();
        withRegistry = new AuthorityRegistry(DTK, address(erc8004));
        withoutRegistry = new AuthorityRegistry(DTK, address(0));
    }

    function test_registryAddressIsRecorded() public {
        assertEq(withRegistry.ERC8004_IDENTITY(), address(erc8004));
        assertEq(withoutRegistry.ERC8004_IDENTITY(), address(0));
    }

    /// The mainnet path: an id is only accepted if ERC-8004 says the caller owns it.
    function test_bindsWhenCallerOwnsTheAgent() public {
        vm.prank(alice);
        uint256 id = erc8004.register();

        vm.prank(alice);
        withRegistry.bindAgentFromERC8004(id);

        assertEq(withRegistry.agentIdOf(alice), id);
    }

    function test_rejectsCallerWhoDoesNotOwnTheAgent() public {
        vm.prank(alice);
        uint256 id = erc8004.register(); // owned by alice, not mallory

        vm.prank(mallory);
        vm.expectRevert("caller does not own that agent");
        withRegistry.bindAgentFromERC8004(id);

        assertEq(withRegistry.agentIdOf(mallory), 0);
    }

    function test_rejectsUnknownAgentId() public {
        vm.prank(alice);
        vm.expectRevert("no such agent");
        withRegistry.bindAgentFromERC8004(999);
    }

    /// Without a registry the ERC-8004 path must be refused rather than silently
    /// degrading into the unchecked one.
    function test_erc8004PathRefusedWhenNoRegistry() public {
        vm.prank(alice);
        vm.expectRevert("no ERC-8004 registry on this chain; use bindAgent");
        withoutRegistry.bindAgentFromERC8004(1);
    }

    /* ---------------- the testnet path ---------------- */

    function test_plainBindWorksWithoutRegistry() public {
        vm.prank(alice);
        withoutRegistry.bindAgent(alice, 1042);
        assertEq(withoutRegistry.agentIdOf(alice), 1042);
    }

    function test_zeroIdRejected() public {
        vm.prank(alice);
        vm.expectRevert("agentId must be non-zero");
        withoutRegistry.bindAgent(alice, 0);
    }

    /// Idempotent rebinding to the same id is fine; changing it is not. Otherwise an
    /// agent could swap ids to dodge a later identity check.
    function test_rebindingToSameIdIsAllowed() public {
        withoutRegistry.bindAgent(alice, 1042);
        withoutRegistry.bindAgent(alice, 1042);
        assertEq(withoutRegistry.agentIdOf(alice), 1042);
    }

    function test_rebindingToDifferentIdRejected() public {
        withoutRegistry.bindAgent(alice, 1042);
        vm.expectRevert("agent already bound to a different id");
        withoutRegistry.bindAgent(alice, 2000);
        assertEq(withoutRegistry.agentIdOf(alice), 1042, "binding must not change on failure");
    }
}
