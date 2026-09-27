// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import {Test} from "forge-std/Test.sol";
import {AllowedTargetsEnforcer} from "delegation-framework/enforcers/AllowedTargetsEnforcer.sol";
import {AllowedMethodsEnforcer} from "delegation-framework/enforcers/AllowedMethodsEnforcer.sol";
import {ERC20PeriodTransferEnforcer} from "delegation-framework/enforcers/ERC20PeriodTransferEnforcer.sol";
import {TimestampEnforcer} from "delegation-framework/enforcers/TimestampEnforcer.sol";
import {LimitedCallsEnforcer} from "delegation-framework/enforcers/LimitedCallsEnforcer.sol";

/// @notice Proves the caveat enforcers we deploy read the same `terms` as MetaMask's.
///
/// @dev Why self-deploy at all. DTK's deploy script uses CREATE2 with a salt read from
///      an environment variable that is never published, so the addresses of
///      TimestampEnforcer and LimitedCallsEnforcer on Monad cannot be derived. We
///      deploy our own rather than guess.
///
///      Why not assert bytecode equality. We tried. It fails, and it fails for a
///      reason that has nothing to do with behaviour: our foundry.toml sets
///      `bytecode_hash = "none"` and a different optimizer, so the metadata tail and
///      some push patterns differ. Byte equality is a proxy for equivalence, and a
///      bad proxy: it would fail on a cosmetic change and pass on a semantic one.
///
///      So we assert the property that actually matters. The same bytes must decode
///      to the same values through the live enforcer and through ours. If our layout
///      or our source had drifted, the decoding would differ, which is the failure we
///      would actually care about.
contract CaveatEnforcerParityTest is Test {
    address constant LIVE_ALLOWED_TARGETS = 0x7F20f61b1f09b08D970938F6fa563634d65c4EeB;
    address constant LIVE_ALLOWED_METHODS = 0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5;
    address constant LIVE_ERC20_PERIOD = 0x474e3Ae7E169e940607cC624Da8A15Eb120139aB;

    address constant WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;

    function setUp() public {
        vm.createSelectFork(
            vm.envOr("MONAD_TESTNET_RPC", string("https://testnet-rpc.monad.xyz")),
            vm.envOr("MONAD_FORK_BLOCK", uint256(65825199))
        );
    }

    /* ---------------- terms decode identically ---------------- */

    function test_allowedTargetsDecodesIdentically() public {
        bytes memory terms = abi.encodePacked(WMON, address(0xBEEF));
        address[] memory live = AllowedTargetsEnforcer(LIVE_ALLOWED_TARGETS).getTermsInfo(terms);
        address[] memory ours = new AllowedTargetsEnforcer().getTermsInfo(terms);
        assertEq(ours.length, live.length, "our AllowedTargets decodes a different count");
        for (uint256 i = 0; i < ours.length; ++i) {
            assertEq(ours[i], live[i], "our AllowedTargets decodes differently from the live one");
        }
    }

    function test_allowedMethodsDecodesIdentically() public {
        bytes memory terms = abi.encodePacked(bytes4(0xa9059cbb), bytes4(0x38ed1739));
        bytes4[] memory live = AllowedMethodsEnforcer(LIVE_ALLOWED_METHODS).getTermsInfo(terms);
        bytes4[] memory ours = new AllowedMethodsEnforcer().getTermsInfo(terms);
        assertEq(ours.length, live.length, "our AllowedMethods decodes a different count");
        for (uint256 i = 0; i < ours.length; ++i) {
            assertEq(ours[i], live[i], "our AllowedMethods decodes differently from the live one");
        }
    }

    function test_erc20PeriodTransferDecodesIdentically() public {
        bytes memory terms = abi.encodePacked(WMON, uint256(0.5 ether), uint256(24 hours), uint256(1789756800));
        (address lt, uint256 la, uint256 ld, uint256 ls) = ERC20PeriodTransferEnforcer(LIVE_ERC20_PERIOD).getTermsInfo(terms);
        (address ot, uint256 oa, uint256 od, uint256 os_) = new ERC20PeriodTransferEnforcer().getTermsInfo(terms);
        assertEq(ot, lt, "token differs");
        assertEq(oa, la, "amount differs");
        assertEq(od, ld, "duration differs");
        assertEq(os_, ls, "startDate differs");
    }

    /// The two enforcers with no live counterpart. If our source for these ever
    /// diverges from DTK's, this is the test that would stop noticing, so the
    /// length contract is pinned explicitly.
    function test_ourTimestampReadsTheDeclaredLayout() public {
        TimestampEnforcer t = new TimestampEnforcer();
        // 32 bytes, first half "after", second half "before", both big-endian.
        bytes memory terms = abi.encodePacked(bytes16(0), bytes16(uint128(1789756800)));
        (uint128 after_, uint128 before_) = t.getTermsInfo(terms);
        assertEq(after_, 0);
        assertEq(before_, 1789756800);
        // 16 bytes is not a valid Timestamp terms length.
        vm.expectRevert("TimestampEnforcer:invalid-terms-length");
        t.getTermsInfo(abi.encodePacked(uint128(1)));
    }

    function test_ourLimitedCallsReadsTheDeclaredLayout() public {
        LimitedCallsEnforcer l = new LimitedCallsEnforcer();
        assertEq(l.getTermsInfo(abi.encode(uint256(20))), 20);
        vm.expectRevert("LimitedCallsEnforcer:invalid-terms-length");
        l.getTermsInfo(abi.encode(uint256(1), uint256(2)));
    }

    /* ---------------- the live ones are really live ---------------- */

    function test_liveBuiltinsHaveCode() public {
        assertGt(LIVE_ALLOWED_TARGETS.code.length, 0, "AllowedTargets missing on chain");
        assertGt(LIVE_ALLOWED_METHODS.code.length, 0, "AllowedMethods missing on chain");
        assertGt(LIVE_ERC20_PERIOD.code.length, 0, "ERC20PeriodTransfer missing on chain");
    }
}
