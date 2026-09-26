// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {DelegationManager} from "delegation-framework/DelegationManager.sol";
import {EIP7702StatelessDeleGator} from "delegation-framework/EIP7702/EIP7702StatelessDeleGator.sol";
import {AllowedTargetsEnforcer} from "delegation-framework/enforcers/AllowedTargetsEnforcer.sol";
import {AllowedMethodsEnforcer} from "delegation-framework/enforcers/AllowedMethodsEnforcer.sol";
import {ERC20PeriodTransferEnforcer} from "delegation-framework/enforcers/ERC20PeriodTransferEnforcer.sol";
import {TimestampEnforcer} from "delegation-framework/enforcers/TimestampEnforcer.sol";
import {LimitedCallsEnforcer} from "delegation-framework/enforcers/LimitedCallsEnforcer.sol";
import {IdentityRegistryUpgradeable} from "erc-8004/IdentityRegistryUpgradeable.sol";

/// @notice Proves the full dependency graph compiles. Replaced by the real contracts.
contract Smoke {
    function sizes() external pure returns (uint256 identity) {
        identity = type(IdentityRegistryUpgradeable).creationCode.length;
    }

}
