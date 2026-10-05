// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {MultiSigDeleGator} from "delegation-framework/MultiSigDeleGator.sol";
import {IDelegationManager} from "delegation-framework/interfaces/IDelegationManager.sol";
import {IEntryPoint} from "@account-abstraction/interfaces/IEntryPoint.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Deploys a user-owned root delegator, because 7702 does not apply on testnet.
///
/// @dev The planned shape of Mandat was: one passkey, one EOA, 7702-delegated to
///      the DTK deleGator. That is not available on Monad testnet. The chain
///      accepts a type 0x04 transaction, includes it with status success and
///      charges for the authorization list, but never stores the delegation:
///      `eth_getCode` on the account stays `0x`, `VERSION()` returns nothing, and
///      the account can still send plain transfers. Tx and evidence in
///      working/constraints.md 11, tracked as OPEN-04.
///
///      `redeemDelegations` executes through
///      `IDeleGatorCore(rootDelegator).executeFromExecutor`, so the root
///      delegator must have code. A `MultiSigDeleGator` behind an ERC-1967 proxy
///      is DTK's own answer for that, and it is what the library's tests deploy
///      (test/utils/BaseTest.t.sol:451).
///
///      What this changes: the root delegator is a contract the user owns, not
///      the EOA itself. The user's EOA is its sole signer with threshold 1, so it
///      keeps exactly the control it would have had. `AuthorityRegistry` already
///      verifies contract delegators over ERC-1271, so registration is unchanged.
///
///      What this does not change: the cap, the caveats, the enforcers, and the
///      pass/revert evidence pair that G6 exists to produce.
contract DeployRootDeleGator is Script {
    address constant DTK_DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;
    address constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    /// @notice Implementation, then the proxy that becomes the root delegator.
    /// @dev Two deployments, printed separately: the proxy is the delegator, and
    ///      the implementation behind it is not the account anyone delegates from.
    function run() external {
        address user = vm.addr(vm.envUint("USER_PRIVATE_KEY"));

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));

        MultiSigDeleGator implementation = new MultiSigDeleGator(
            IDelegationManager(DTK_DELEGATION_MANAGER), IEntryPoint(ENTRY_POINT)
        );

        address[] memory signers = new address[](1);
        signers[0] = user;

        // initialize() is what sets the signers, and the constructor calls
        // _disableInitializers, so the proxy has to carry the call. That is the
        // pattern DTK's own tests use.
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(implementation), abi.encodeWithSignature("initialize(address[],uint256)", signers, uint256(1))
        );

        vm.stopBroadcast();

        console.log("signer (user EOA):   ", user);
        console.log("threshold:           ", uint256(1));
        console.log("implementation:      ", address(implementation));
        console.log("root delegator:      ", address(proxy));
    }
}
