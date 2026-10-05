// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {AllowedTargetsEnforcer} from "delegation-framework/enforcers/AllowedTargetsEnforcer.sol";
import {AllowedMethodsEnforcer} from "delegation-framework/enforcers/AllowedMethodsEnforcer.sol";
import {ERC20PeriodTransferEnforcer} from "delegation-framework/enforcers/ERC20PeriodTransferEnforcer.sol";
import {TimestampEnforcer} from "delegation-framework/enforcers/TimestampEnforcer.sol";
import {LimitedCallsEnforcer} from "delegation-framework/enforcers/LimitedCallsEnforcer.sol";

/// @notice Checks the envelope that @mandat/envelope-cli generates against the
///         caveat enforcers that are actually live on Monad.
///
/// @dev This is the test that matters most in the whole envelope path. DTK's
///      `terms` are NOT abi.encode: every enforcer reads a bespoke packed layout and
///      several reject the wrong length outright. An encoder written from the type
///      signature instead of the source produces terms that revert at redemption,
///      not at compile time, which is the worst place to find out.
///
///      So we do not assert against our own decoder. We call getTermsInfo() on the
///      LIVE contracts, which is the same function the enforcer itself uses, and check
///      it returns what the manifest asked for. If our layout is wrong, the enforcer
///      disagrees with us in the same way it would disagree during a real redemption.
///
///      Regenerate with:
///        cd packages/envelope-cli && pnpm envelope compile \
///          ../../contracts/fixtures/wmon-spend/SKILL.md \
///          ../../contracts/fixtures/wmon-spend/compiled.json
contract CompiledEnvelopeTest is Test {
    using stdJson for string;

    // Live on both 143 and 10143.
    address constant LIVE_ALLOWED_TARGETS = 0x7F20f61b1f09b08D970938F6fa563634d65c4EeB;
    address constant LIVE_ALLOWED_METHODS = 0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5;
    address constant LIVE_ERC20_PERIOD = 0x474e3Ae7E169e940607cC624Da8A15Eb120139aB;

    address constant WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;
    bytes4 constant TRANSFER = 0xa9059cbb;

    string internal json;

    function setUp() public {
        vm.createSelectFork(
            vm.envOr("MONAD_TESTNET_RPC", string("https://testnet-rpc.monad.xyz")),
            vm.envOr("MONAD_FORK_BLOCK", uint256(65825199))
        );
        json = vm.readFile("fixtures/wmon-spend/compiled.json");
    }

    function _terms(string memory key) internal view returns (bytes memory) {
        return json.readBytes(string.concat(".enforcers.", key));
    }

    /* ---------------- live builtins ---------------- */

    function test_allowedTargetsTermsDecodeOnTheLiveEnforcer() public {
        bytes memory terms = _terms("allowedTargets");
        address[] memory targets = AllowedTargetsEnforcer(LIVE_ALLOWED_TARGETS).getTermsInfo(terms);
        assertEq(targets.length, 1);
        assertEq(targets[0], WMON);
    }

    function test_allowedMethodsTermsDecodeOnTheLiveEnforcer() public {
        bytes memory terms = _terms("allowedMethods");
        bytes4[] memory selectors = AllowedMethodsEnforcer(LIVE_ALLOWED_METHODS).getTermsInfo(terms);
        assertEq(selectors.length, 1);
        assertEq(selectors[0], TRANSFER);
    }

    /// The token lives in the terms, not in args. Getting that backwards is silent
    /// until the enforcer reverts with invalid-contract on the first transfer.
    function test_erc20PeriodTransferTermsDecodeOnTheLiveEnforcer() public {
        bytes memory terms = _terms("erc20PeriodTransfer");
        (address token, uint256 amount, uint256 duration, uint256 startDate) =
            ERC20PeriodTransferEnforcer(LIVE_ERC20_PERIOD).getTermsInfo(terms);

        assertEq(token, WMON);
        assertEq(amount, 0.5 ether, "cap should be half a WMON");
        assertEq(duration, 24 hours, "period should be 24h");
        assertGt(startDate, 0, "enforcer rejects a zero startDate");
    }

    function test_termLengthsMatchWhatTheEnforcersDemand() public {
        // Each enforcer hard-requires these lengths. Asserting them here means a
        // change in our encoder fails with a clear message instead of a revert
        // during a recorded demo.
        assertEq(_terms("allowedTargets").length, 20, "AllowedTargets wants n*20");
        assertEq(_terms("allowedMethods").length, 4, "AllowedMethods wants n*4");
        assertEq(_terms("erc20PeriodTransfer").length, 116, "ERC20PeriodTransfer wants exactly 116");
    }

    /* ---------------- our own two ---------------- */

    function test_timestampTermsDecode() public {
        TimestampEnforcer t = new TimestampEnforcer();
        bytes memory terms = _terms("timestamp");
        assertEq(terms.length, 32, "TimestampEnforcer wants exactly 32 bytes");
        (uint128 after_, uint128 before_) = t.getTermsInfo(terms);
        assertEq(after_, 0, "no lower bound was declared");
        assertEq(uint256(before_), uint256(json.readUint(".summary.notAfter")));
    }

    function test_limitedCallsTermsDecode() public {
        LimitedCallsEnforcer l = new LimitedCallsEnforcer();
        bytes memory terms = _terms("limitedCalls");
        assertEq(terms.length, 32, "LimitedCallsEnforcer wants exactly 32 bytes");
        assertEq(l.getTermsInfo(terms), 20, "maxCalls should be 20");
    }

    /* ---------------- the whole envelope, against the chain ---------------- */

    function test_everyCaveatIsPresent() public {
        assertEq(json.readUint(".caveatCount"), 6, "targets, methods, period, timestamp, calls, mandat");
    }

    function test_skillAuthorityTermsAre160Bytes() public {
        assertEq(_terms("skillAuthority").length, 160, "SkillAuthorityEnforcer terms are 5 words: version, checks, manifest, parent, seller");
    }

    /* ---------------- the manifest is what the terms say ---------------- */

    function test_summaryAgreesWithWhatTheChainDecodes() public {
        bytes memory terms = _terms("erc20PeriodTransfer");
        (,, uint256 duration,) = ERC20PeriodTransferEnforcer(LIVE_ERC20_PERIOD).getTermsInfo(terms);
        uint256 fromJson = json.readUint(".summary.tokenCaps[0].periodSeconds");
        assertEq(fromJson, duration, "summary and chain must agree on the period");
    }
}
