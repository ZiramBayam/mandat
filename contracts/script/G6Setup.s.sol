// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import {Script} from "forge-std/Script.sol";
import {console2 as console} from "forge-std/console2.sol";
import {Delegation, Caveat, ModeCode} from "delegation-framework/utils/Types.sol";
import {ERC1271Lib} from "delegation-framework/libraries/ERC1271Lib.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {AuthorityRegistry} from "../src/AuthorityRegistry.sol";
import {IERC7821} from "delegation-framework/interfaces/IERC7821.sol";
import {IDelegationManagerConstants} from "../src/AuthorityRegistry.sol";

interface IWrappedMon {
    function deposit() external payable;
    function balanceOf(address) external view returns (uint256);
    function withdraw(uint256) external;
}

/// @notice Builds the whole authority chain for the G6 demo, on a forked testnet.
///
/// @dev Runs against a fork so every step is verified before anything is broadcast.
///      Broadcast the real steps with `forge script ... --broadcast`, or run the
///      pieces individually with the `step*` entry points, which is how the demo is
///      recorded: each tx hash is one claim in the video.
///
///      The order matters and is not obvious:
///
///        1. The USER EOA must deposit WMON *before* it is 7702-delegated.
///        2. It must also be 7702-delegated *before* anyone tries to spend on its
///           behalf, because the deleGator is what executes the transfer.
///        3. After delegation the USER EOA can never send a transaction again:
///           `execute` only accepts the EntryPoint or itself, and
///           `executeFromExecutor` only accepts the DelegationManager. Any step that
///           needs the USER EOA to act must come first.
contract G6Setup is Script {
    address constant DTK_DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;
    address constant DELEGATOR_7702 = 0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B;
    address constant WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;

    function run() external {
        console.log("This script is a reference for the steps. Run the step* entries individually.");
    }

    /* ---------------- step 1: the user holds WMON ---------------- */

    /// @notice Wrap MON into WMON. Must happen while the EOA is still undelegated,
    ///         because a delegated EOA cannot lower its own balance.
    function stepDeposit() external {
        uint256 amount = vm.envOr("WRAP_AMOUNT_WEI", uint256(1 ether));
        vm.startBroadcast(vm.envUint("USER_PRIVATE_KEY"));
        IWrappedMon(WMON).deposit{value: amount}();
        vm.stopBroadcast();
        console.logString("user WMON");
        console.logUint(IWrappedMon(WMON).balanceOf(vm.addr(vm.envUint("USER_PRIVATE_KEY"))));
    }

    /// @dev The 7702 step is NOT here. forge-std has no cheatcode for a type 0x04
    ///      transaction, and hand-rolling the RLP envelope is exactly the kind of
    ///      low-level guesswork that is hard to review and easy to get subtly wrong.
    ///      It lives in packages/three-light/scripts/delegate-7702.ts, which uses viem.

    /* ---------------- step 2: publish the consent document ---------------- */

    /// @notice Register the manifest and bind the agent identity.
    /// @dev Manifest registration is permissionless. bindAgent is the testnet path
    ///      because Monad testnet has no ERC-8004 Identity Registry; on mainnet
    ///      bindAgentFromERC8004 checks the id against the real registry.
    function stepPublishManifest() external {
        address registry = vm.envAddress("AUTHORITY_REGISTRY");
        bytes32 manifestHash = vm.envBytes32("MANIFEST_HASH");

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        AuthorityRegistry(registry).registerManifest(manifestHash, vm.envOr("MANIFEST_CID", string("bafybeiexamplecid")));
        AuthorityRegistry(registry).bindAgent(vm.addr(vm.envUint("AGENT_PRIVATE_KEY")), 1042);
        AuthorityRegistry(registry).bindAgent(vm.addr(vm.envUint("SUBAGENT_PRIVATE_KEY")), 1043);
        vm.stopBroadcast();

        // This forge-std has no variadic console.log, so pairs are two calls.
        console.logString("manifest");
        console.logBytes32(manifestHash);
        console.logString("agent id");
        console.logUint(AuthorityRegistry(registry).agentIdOf(vm.addr(vm.envUint("AGENT_PRIVATE_KEY"))));
    }

    /* ---------------- step 3: build and register the delegation ---------------- */

    /// @notice Create the root delegation, user -> agent, carrying the compiled caveats.
    /// @dev Returned as JSON so the agent step can consume it without recomputing.
    ///      The signature is EIP-712 over DTK's own domain, so it is the same
    ///      signature redeemDelegations will verify later.
    function buildDelegation() public view returns (Delegation memory d) {
        address user = vm.addr(vm.envUint("USER_PRIVATE_KEY"));
        address agent = vm.addr(vm.envUint("AGENT_PRIVATE_KEY"));
        bytes32 manifestHash = vm.envBytes32("MANIFEST_HASH");
        bytes32 parentHash = vm.envOr("PARENT_DELEGATION_HASH", bytes32(0));

        Caveat[] memory cs = new Caveat[](6);
        cs[0] = Caveat({
            enforcer: vm.envAddress("ENFORCER_ALLOWED_TARGETS"),
            terms: abi.encodePacked(WMON),
            args: ""
        });
        cs[1] = Caveat({
            enforcer: vm.envAddress("ENFORCER_ALLOWED_METHODS"),
            terms: abi.encodePacked(bytes4(0xa9059cbb)),
            args: ""
        });
        cs[2] = Caveat({
            enforcer: vm.envAddress("ENFORCER_ERC20_PERIOD"),
            terms: abi.encodePacked(WMON, uint256(0.5 ether), uint256(24 hours), uint256(block.timestamp)),
            args: ""
        });
        cs[3] = Caveat({
            enforcer: vm.envAddress("ENFORCER_TIMESTAMP"),
            terms: abi.encodePacked(bytes16(0), bytes16(uint128(block.timestamp + 7 days))),
            args: ""
        });
        cs[4] = Caveat({
            enforcer: vm.envAddress("ENFORCER_LIMITED_CALLS"),
            terms: abi.encode(uint256(20)),
            args: ""
        });
        cs[5] = Caveat({
            enforcer: vm.envAddress("SKILL_AUTHORITY_ENFORCER"),
            terms: abi.encode(
                uint8(1),
                uint8(0x07),
                parentHash == bytes32(0) ? manifestHash : manifestHash,
                parentHash
            ),
            args: ""
        });

        d = Delegation({
            delegate: agent,
            delegator: user,
            authority: parentHash == bytes32(0) ? bytes32(type(uint256).max) : parentHash,
            caveats: cs,
            salt: uint256(vm.envOr("DELEGATION_SALT", uint256(1))),
            signature: ""
        });

        (uint8 v, bytes32 r, bytes32 sig) = vm.sign(
            vm.envUint("USER_PRIVATE_KEY"),
            MessageHashUtils.toTypedDataHash(
                IDelegationManagerConstants(DTK_DELEGATION_MANAGER).getDomainHash(),
                IDelegationManagerConstants(DTK_DELEGATION_MANAGER).getDelegationHash(d)
            )
        );
        d.signature = abi.encodePacked(r, sig, v);
    }

    /// @notice Submit the delegation to the registry. Permissionless but self-validating.
    function stepRegisterDelegation() external {
        vm.broadcast(vm.envUint("AGENT_PRIVATE_KEY"));
        AuthorityRegistry(vm.envAddress("AUTHORITY_REGISTRY")).registerDelegation(
            buildDelegation(), vm.envBytes32("MANIFEST_HASH")
        );
        console.logString("registry delegationCount");
        console.logUint(AuthorityRegistry(vm.envAddress("AUTHORITY_REGISTRY")).delegationCount());
    }
}
