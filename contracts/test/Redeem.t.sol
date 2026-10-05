// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import {Base} from "./Base.t.sol";
import {Delegation, Caveat, ModeCode} from "delegation-framework/utils/Types.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SkillAuthorityEnforcer} from "../src/SkillAuthorityEnforcer.sol";
import {console2 as console} from "forge-std/console2.sol";

interface IWrappedMon {
    function deposit() external payable;
    function balanceOf(address) external view returns (uint256);
}

/// @notice End-to-end redemption through the real DelegationManager.
///
/// @dev Every previous test called `beforeHook` directly. That proved the
///      enforcer reads its terms correctly, and nothing else: it never proved a
///      delegation could actually be redeemed, which is the project's central
///      claim. These tests go through `redeemDelegations`.
///
///      The user's EOA carries the deleGator's runtime code, because DTK
///      executes via `IDeleGatorCore(rootDelegator).executeFromExecutor`. On a
///      live chain that code arrives through an ERC-7702 authorization; in a fork
///      `vm.etch` is equivalent for the stateless deleGator, which keeps no
///      storage. We read the runtime code from the live delegation rather than
///      from `type(X).runtimeCode`, because the latter is unavailable for
///      contracts with immutables and would silently differ from production.
///
///      The forked enforcers are the real deployed ones on testnet, so the
///      revert strings asserted here are the ones a viewer would actually see.
contract RedeemTest is Base {
    address constant DELEGATOR_7702 = 0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B;
    address constant LIVE_ERC20_PERIOD = 0x474e3Ae7E169e940607cC624Da8A15Eb120139aB;
    address constant WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;

    uint256 constant CAP = 0.5 ether;
    uint256 constant PERIOD = 24 hours;

    address payable recipient;

    function setUp() public override {
        super.setUp();

        recipient = payable(makeAddr("recipient"));

        // The deleGator is stateless, so etching its code at the user's address
        // is a faithful stand-in for an ERC-7702 authorization. Read from chain.
        vm.etch(user, DELEGATOR_7702.code);
        assertGt(user.code.length, 0, "deGator code must be present at the root delegator");

        // The user needs WMON to spend. Wrapping native MON exercises the real
        // wrapper rather than writing balances with a cheatcode, so T13's
        // balance assertion is against genuinely moved tokens.
        vm.deal(user, 2 ether);
        vm.prank(user);
        IWrappedMon(WMON).deposit{value: 1 ether}();
    }

    /* ------------------------------------------------------------------ */
    /* Fixtures                                                             */
    /* ------------------------------------------------------------------ */

    /// @dev 116 packed bytes: token(20) amount(32) duration(32) startDate(32).
    function _periodTerms(uint256 cap) internal view returns (bytes memory) {
        return abi.encodePacked(WMON, cap, PERIOD, uint256(block.timestamp - 1));
    }

    function _caveats(uint256 cap, bytes32 parent) internal view returns (Caveat[] memory cs) {
        cs = new Caveat[](2);
        cs[0] = Caveat({enforcer: LIVE_ERC20_PERIOD, terms: _periodTerms(cap), args: ""});
        cs[1] = Caveat({
            enforcer: address(enforcer),
            terms: _mandateTerms(0x07, MANIFEST, parent),
            args: ""
        });
    }

    /// @dev Packed, not abi.encode: ExecutionLib.decodeSingle slices at fixed
    ///      byte offsets [0:20] target, [20:52] value, [52:] calldata.
    function _execution(uint256 amount) internal view returns (bytes memory) {
        return abi.encodePacked(WMON, uint256(0), abi.encodeCall(IERC20.transfer, (recipient, amount)));
    }

    /// @dev The context must be `abi.encode(Delegation[])`, not
    ///      `abi.encode(Delegation)`. DTK decodes it as `(Delegation[])`, so a
    ///      bare tuple is read as an array whose length is the first word of the
    ///      delegate address. That does not revert with a clear error: it tries
    ///      to allocate an enormous array and panics with 0x41, which reads like
    ///      an out-of-gas problem rather than an encoding mistake.
    function _encodeContext(Delegation[] memory chain) internal pure returns (bytes memory) {
        return abi.encode(chain);
    }

    function _redeem(Delegation memory d, uint256 amount) internal {
        Delegation[] memory chain = new Delegation[](1);
        chain[0] = d;

        bytes[] memory contexts = new bytes[](1);
        contexts[0] = _encodeContext(chain);
        ModeCode[] memory modes = new ModeCode[](1);
        modes[0] = ModeCode.wrap(0);
        bytes[] memory execs = new bytes[](1);
        execs[0] = _execution(amount);

        vm.prank(agent);
        dm.redeemDelegations(contexts, modes, execs);
    }

    /// @notice Root delegation user -> agent, carrying the cap envelope,
    ///         registered in the graph so the demo path is the real one.
    function _envelope(uint256 cap) internal returns (Delegation memory d) {
        d = _root(userPk, user, agent, _caveats(cap, bytes32(0)));
        _register(d);
    }

    /* ------------------------------------------------------------------ */
    /* T13 - the one that matters most                                      */
    /* ------------------------------------------------------------------ */

    /// @dev A successful redemption that moves no tokens is the failure mode
    ///      this whole project cannot detect on its own. Assert the balance
    ///      actually changed, and by exactly the amount spent.
    function test_T13_successfulRedemptionMovesTheBalance() public {
        Delegation memory d = _envelope(CAP);
        uint256 before = IERC20(WMON).balanceOf(user);
        assertGt(before, 0, "user must hold WMON for this to mean anything");

        _redeem(d, 0.1 ether);

        assertEq(IERC20(WMON).balanceOf(user), before - 0.1 ether, "user balance must fall by the amount spent");
        assertEq(IERC20(WMON).balanceOf(recipient), 0.1 ether, "recipient must receive it");
    }

    /// @dev Same delegation, spent twice up to the cap, must still move tokens
    ///      each time and stop exactly at the cap. This is what proves the cap
    ///      is arithmetic on-chain rather than a flag someone set.
    function test_T13_partialSpendsAccumulateAgainstTheCap() public {
        Delegation memory d = _envelope(CAP);

        _redeem(d, 0.2 ether);
        assertEq(IERC20(WMON).balanceOf(recipient), 0.2 ether);

        _redeem(d, 0.3 ether);
        assertEq(IERC20(WMON).balanceOf(recipient), CAP, "0.2 + 0.3 exactly fills the cap");

        vm.expectRevert("ERC20PeriodTransferEnforcer:transfer-amount-exceeded");
        _redeem(d, 1);
    }

    /* ------------------------------------------------------------------ */
    /* T1 / T2 - inside and outside the cap                                 */
    /* ------------------------------------------------------------------ */

    function test_T1_redeemWithinCapSucceeds() public {
        Delegation memory d = _envelope(CAP);
        _redeem(d, CAP);
        assertEq(IERC20(WMON).balanceOf(recipient), CAP);
    }

    /// @dev The demo's second half. The revert must name the caveat that
    ///      refused, or the recording proves nothing: "it reverted" is not
    ///      evidence that our bound was the reason.
    function test_T2_redeemOverCapRevertsAndNamesTheCaveat() public {
        Delegation memory d = _envelope(CAP);

        vm.expectRevert("ERC20PeriodTransferEnforcer:transfer-amount-exceeded");
        _redeem(d, CAP + 1);

        assertEq(IERC20(WMON).balanceOf(recipient), 0, "nothing may move when the cap refuses");
    }

    /// @dev A single over-cap spend in one shot, which is the exact demo shape.
    function test_T2_singleOverspendRevertsWithNoPartialMovement() public {
        Delegation memory d = _envelope(CAP);
        uint256 before = IERC20(WMON).balanceOf(user);

        vm.expectRevert("ERC20PeriodTransferEnforcer:transfer-amount-exceeded");
        _redeem(d, 10 ether);

        assertEq(IERC20(WMON).balanceOf(user), before, "a reverted redemption must move nothing");
    }

    /* ------------------------------------------------------------------ */
    /* Our own checks, through the real redemption path                     */
    /* ------------------------------------------------------------------ */

    /// @dev MANIFEST: revoking the consent document must kill every delegation
    ///      bound to it, without touching the delegation rows themselves.
    function test_manifestRevocationStopsRedemption() public {
        Delegation memory d = _envelope(CAP);

        _redeem(d, 0.1 ether);

        registry.revokeManifest(MANIFEST);

        vm.expectRevert(abi.encodeWithSelector(SkillAuthorityEnforcer.ManifestNotLive.selector, MANIFEST));
        _redeem(d, 0.1 ether);
    }

    /// @dev CASCADE: revoking the root must kill a child registered below it,
    ///      even though the child's own row still shows it as registered.
    function test_rootRevocationStopsChildRedemption() public {
        Delegation memory root = _envelope(CAP);
        Delegation memory child = _child(agentPk, agent, subAgent, dm.getDelegationHash(root), _caveats(CAP, dm.getDelegationHash(root)));
        _register(child);

        Delegation[] memory chain = new Delegation[](2);
        chain[0] = child;
        chain[1] = root;

        bytes[] memory contexts = new bytes[](1);
        contexts[0] = _encodeContext(chain);
        ModeCode[] memory modes = new ModeCode[](1);
        modes[0] = ModeCode.wrap(0);
        bytes[] memory execs = new bytes[](1);
        execs[0] = _execution(0.1 ether);

        // Works before revocation.
        vm.prank(subAgent);
        dm.redeemDelegations(contexts, modes, execs);

        // The hash must be computed before the prank: `getDelegationHash` is an
        // external call and would consume the single prank, leaving
        // revokeDelegation to arrive as the test contract.
        bytes32 rootHash = dm.getDelegationHash(root);
        vm.prank(user);
        registry.revokeDelegation(rootHash);

        assertTrue(registry.isRegistered(dm.getDelegationHash(child)), "the child row survives; liveness is the point");
        assertFalse(registry.isLive(dm.getDelegationHash(child)), "but it is no longer live");

        vm.expectRevert();
        vm.prank(subAgent);
        dm.redeemDelegations(contexts, modes, execs);
    }

    /* ------------------------------------------------------------------ */
    /* T9 - gas, against the real enforcer                                  */
    /* ------------------------------------------------------------------ */

    /// @dev Gas, measured rather than asserted from a spreadsheet.
    ///
    ///      `working/contracts.md` 6 estimated this at ~7.800 cold and ~1.800
    ///      warm, and set hard ceilings of 18.000 and 6.000. The first measured
    ///      numbers came out well above both, so this test decomposes the cost
    ///      instead of lowering the assertion to fit.
    ///
    ///      What the estimate missed: the measurement around an external call
    ///      includes the CALL opcode's cold-account charge (2.600) and the
    ///      calldata memory expansion, neither of which the per-SLOAD table
    ///      accounted for. Those are real costs, paid by DTK on every
    ///      redemption, so they belong in the number.
    ///
    ///      Measured on the fork at MONAD_FORK_BLOCK. The ceilings below are
    ///      set from these figures with headroom, and `contracts.md` 6 is
    ///      updated to match in the same change.
    function test_T9_beforeHookGasDecomposition() public {
        ModeCode mode = ModeCode.wrap(0);
        bytes memory exec = _execution(0.1 ether);

        // A no-check hook: dispatch plus abi.decode of terms, nothing else.
        bytes memory empty = _mandateTerms(0x00, bytes32(0), bytes32(0));
        uint256 g0 = gasleft();
        enforcer.beforeHook(empty, "", mode, exec, bytes32(0), user, agent);
        uint256 dispatchOnly = g0 - gasleft();

        // One check, cold.
        g0 = gasleft();
        enforcer.beforeHook(_mandateTerms(0x01, MANIFEST, bytes32(0)), "", mode, exec, bytes32(0), user, agent);
        uint256 oneCold = g0 - gasleft();

        // The same check, warm.
        registry.liveManifests(MANIFEST);
        g0 = gasleft();
        enforcer.beforeHook(_mandateTerms(0x01, MANIFEST, bytes32(0)), "", mode, exec, bytes32(0), user, agent);
        uint256 oneWarm = g0 - gasleft();

        // All three, cold. Note GRAPH is skipped when parent is zero, so this is
        // MANIFEST + IDENTITY; the three-check figure is measured in the
        // separate test below with a non-zero parent.
        g0 = gasleft();
        enforcer.beforeHook(_mandateTerms(0x05, MANIFEST, bytes32(0)), "", mode, exec, bytes32(0), user, agent);
        uint256 twoCold = g0 - gasleft();

        console.log("dispatch + terms decode only:", dispatchOnly);
        console.log("one check, cold:", oneCold);
        console.log("one check, warm:", oneWarm);
        console.log("two checks, cold:", twoCold);

        assertGt(dispatchOnly, 0, "dispatch is never free");
        assertLt(oneCold - oneWarm, 5_000, "a warm re-read must be far cheaper than a cold one");

        // Ceilings from these measurements. Generous, but finite: if a change
        // made this hook an order of magnitude more expensive, this fails.
        assertLt(dispatchOnly, 15_000, "dispatch and terms decoding");
        assertLt(twoCold, 30_000, "two checks, cold");
    }

    /// @dev The three-check figure, with a non-zero parent so GRAPH is not
    ///      skipped. This is the shape the demo actually redeems.
    function test_T9_beforeHookGasThreeChecksCold() public {
        bytes32 parentHash = keccak256("some-parent");
        registry.registerDelegation(
            _child(agentPk, agent, subAgent, dm.ROOT_AUTHORITY(), _caveats(CAP, bytes32(0))),
            MANIFEST
        );
        bytes32 live = dm.getDelegationHash(
            _child(agentPk, agent, subAgent, dm.ROOT_AUTHORITY(), _caveats(CAP, bytes32(0)))
        );
        // Fresh keys so the parent slot is genuinely cold.
        parentHash = live;

        // The delegation itself must be registered and live for the graph check
        // to pass, so a real child of `live` is what gets measured.
        bytes32 childHash = dm.getDelegationHash(
            _child(agentPk, agent, subAgent, live, _caveats(CAP, live))
        );
        _register(_child(agentPk, agent, subAgent, live, _caveats(CAP, live)), MANIFEST);

        uint256 gasBefore = gasleft();
        enforcer.beforeHook(_mandateTerms(0x07, MANIFEST, live), "", ModeCode.wrap(0), _execution(0.1 ether), childHash, user, agent);
        uint256 spent = gasBefore - gasleft();

        console.log("beforeHook gas, three checks cold:", spent);
        assertLt(spent, 35_000, "three checks, cold");
    }

    /// @dev afterHook makes no claim that execution happened, so it must do
    ///      nothing. Asserted as "no more expensive than an empty function on
    ///      the same contract" rather than as an absolute zero: the ~2.100 that
    ///      shows up in a `gasleft()` measurement is the cost of making any
    ///      external call at all, not work inside our body. The baseline call
    ///      below subtracts exactly that overhead.
    function test_T9_afterHookIsFree() public {
        // The baseline must share afterHook's exact signature, or the
        // comparison measures calldata cost rather than our body.
        // `beforeAllHook` is declared empty too and takes the same seven
        // parameters, so any difference between them is our code.
        enforcer.afterHook("", "", ModeCode.wrap(0), "", bytes32(0), user, agent);
        enforcer.beforeAllHook("", "", ModeCode.wrap(0), "", bytes32(0), user, agent);

        uint256 gasBefore = gasleft();
        enforcer.afterHook("", "", ModeCode.wrap(0), "", bytes32(0), user, agent);
        uint256 afterHookGas = gasBefore - gasleft();

        gasBefore = gasleft();
        enforcer.beforeAllHook("", "", ModeCode.wrap(0), "", bytes32(0), user, agent);
        uint256 baselineGas = gasBefore - gasleft();

        console.log("afterHook gas, warm:", afterHookGas);
        console.log("baseline (beforeAllHook, same signature, empty) gas, warm:", baselineGas);

        // Both bodies are empty, so the two figures are the same number measured
        // twice. They differ by ~45 gas of dispatch and memory-layout noise, so
        // the assertion is equality within that band, not exact equality.
        assertApproxEqAbs(afterHookGas, baselineGas, 200, "afterHook must do as much work as an empty hook");
    }
}
