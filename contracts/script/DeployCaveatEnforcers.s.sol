// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {AllowedTargetsEnforcer} from "delegation-framework/enforcers/AllowedTargetsEnforcer.sol";
import {AllowedMethodsEnforcer} from "delegation-framework/enforcers/AllowedMethodsEnforcer.sol";
import {ERC20PeriodTransferEnforcer} from "delegation-framework/enforcers/ERC20PeriodTransferEnforcer.sol";
import {TimestampEnforcer} from "delegation-framework/enforcers/TimestampEnforcer.sol";
import {LimitedCallsEnforcer} from "delegation-framework/enforcers/LimitedCallsEnforcer.sol";

/// @notice Deploys the caveat enforcers Mandat needs, from DTK's own source.
/// @dev MetaMask deploys these on Monad at addresses we know for three of them, but
///      the CREATE2 salt lives in their deploy script's environment and is not
///      published, so the other two cannot be derived. Rather than guess, we deploy
///      our own copies and prove equivalence:
///      test/CaveatEnforcerParity.t.sol asserts our AllowedTargets, AllowedMethods and
///      ERC20PeriodTransfer have runtime bytecode identical to the live ones, which
///      makes our Timestamp and LimitedCalls trustworthy by the same argument.
///
///      Deploying our own also means one address book we control, instead of a
///      dependency on someone else's deployment schedule.
contract DeployCaveatEnforcers is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));

        AllowedTargetsEnforcer allowedTargets = new AllowedTargetsEnforcer();
        AllowedMethodsEnforcer allowedMethods = new AllowedMethodsEnforcer();
        ERC20PeriodTransferEnforcer erc20Period = new ERC20PeriodTransferEnforcer();
        TimestampEnforcer timestamp = new TimestampEnforcer();
        LimitedCallsEnforcer limitedCalls = new LimitedCallsEnforcer();

        vm.stopBroadcast();

        console.log("AllowedTargets:          ", address(allowedTargets));
        console.log("AllowedMethods:          ", address(allowedMethods));
        console.log("ERC20PeriodTransfer:     ", address(erc20Period));
        console.log("Timestamp:               ", address(timestamp));
        console.log("LimitedCalls:            ", address(limitedCalls));
    }
}
