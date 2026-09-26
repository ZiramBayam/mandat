// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {EIP7702StatelessDeleGator} from "delegation-framework/EIP7702/EIP7702StatelessDeleGator.sol";
import {DelegationManager} from "delegation-framework/DelegationManager.sol";
import {IDelegationManager} from "delegation-framework/interfaces/IDelegationManager.sol";

/// @notice Confirms the pinned DTK source matches what is actually live on Monad testnet.
/// @dev Raw bytecode equality is impossible here: both contracts carry immutables
///      (Ownable owner, EntryPoint, delegationManager), so runtimeCode is unavailable and
///      a local deploy can never reproduce the live bytes. We assert behaviour instead.
contract SmokeTest is Test {
    address constant DM = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;
    address constant DELEGATOR = 0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B;
    address constant ALLOWED_TARGETS = 0x7F20f61b1f09b08D970938F6fa563634d65c4EeB;
    address constant ALLOWED_METHODS = 0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5;
    address constant ERC20_PERIOD = 0x474e3Ae7E169e940607cC624Da8A15Eb120139aB;

    uint256 constant TESTNET = 10143;
    string constant TESTNET_RPC = "https://testnet-rpc.monad.xyz";
    uint256 constant FORK_BLOCK = 65825199;
    bytes32 constant EXPECTED_DOMAIN = 0x613a29a66096c9a544314e88658f492cb1c1e31e1062b53b6121f843e4ed61b6;

    function setUp() public {
        vm.createSelectFork(vm.envOr("MONAD_TESTNET_RPC", TESTNET_RPC), vm.envOr("MONAD_FORK_BLOCK", FORK_BLOCK));
    }

    function test_liveContractsHaveCode() public {
        assertGt(DM.code.length, 0, "DelegationManager missing");
        assertGt(DELEGATOR.code.length, 0, "DeleGator missing");
        assertGt(ALLOWED_TARGETS.code.length, 0, "AllowedTargets missing");
        assertGt(ALLOWED_METHODS.code.length, 0, "AllowedMethods missing");
        assertGt(ERC20_PERIOD.code.length, 0, "ERC20PeriodTransfer missing");
    }

    function test_pinnedSourceMatchesLiveVersion() public {
        assertEq(EIP7702StatelessDeleGator(payable(DELEGATOR)).NAME(), "EIP7702StatelessDeleGator");
        assertEq(EIP7702StatelessDeleGator(payable(DELEGATOR)).VERSION(), "1.3.0");
        assertEq(DelegationManager(payable(DM)).NAME(), "DelegationManager");
        assertEq(DelegationManager(payable(DM)).VERSION(), "1.3.0");
    }

    function test_domainHashAndConstants() public {
        DelegationManager dm = DelegationManager(payable(DM));
        assertEq(dm.getDomainHash(), EXPECTED_DOMAIN, "domain hash moved");
        assertEq(dm.ROOT_AUTHORITY(), bytes32(type(uint256).max));
        assertEq(dm.ANY_DELEGATE(), address(0xa11));
    }

    function test_disabledDelegationsIsAView() public {
        bytes32 h = keccak256("not-a-real-delegation");
        assertFalse(DelegationManager(payable(DM)).disabledDelegations(h), "unknown delegation should not be disabled");
    }

    function test_noDelegationsViewExists() public {
        // Recorded as a fact in working/constraints.md 4.2. If a future DTK adds this view,
        // the Authority Header design can be simplified and that file must be updated.
        (bool ok,) = DM.staticcall(abi.encodeWithSignature("delegations(address,bytes32)", address(1), bytes32(0)));
        assertFalse(ok, "delegations(address,bytes32) now exists; update working/constraints.md 4.2");
    }

    function test_localDeployIsFunctional() public {
        // Runtime-code equality against the live contracts is impossible: DelegationManager
        // embeds address(this) in its EIP-712 domain and DelegationManager address in the
        // deleGator, so local bytes can never equal live bytes. What matters is that a local
        // instance behaves like the pinned source says it should.
        DelegationManager local_ = new DelegationManager(address(this));
        assertEq(local_.NAME(), "DelegationManager");
        assertEq(local_.VERSION(), "1.3.0");
        assertFalse(local_.disabledDelegations(keccak256("x")), "fresh manager should have nothing disabled");
        assertEq(local_.ROOT_AUTHORITY(), bytes32(type(uint256).max));
        assertEq(local_.ANY_DELEGATE(), address(0xa11));
        assertEq(local_.owner(), address(this));
    }
}
