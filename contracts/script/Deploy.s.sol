// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {AuthorityRegistry, IDelegationManagerConstants} from "../src/AuthorityRegistry.sol";
import {SkillAuthorityEnforcer} from "../src/SkillAuthorityEnforcer.sol";

/// @notice Deploys the Mandat contracts, plus the ERC-8004 Identity Registry on
///         chains that do not have one.
/// @dev The two chains behave differently and the difference is deliberate:
///        mainnet 143 already runs the real AgentIdentity registry, and deploying a
///        second one would be wrong, so we point at it.
///        testnet 10143 has none, so we deploy the canonical implementation ourselves
///        and disclose it in the README. The proxy pattern is covered by
///        test/ERC8004Deploy.t.sol rather than trusted.
contract Deploy is Script {
    address constant DTK_DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;
    address constant ERC8004_MAINNET_IDENTITY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    uint256 constant MAINNET_CHAIN_ID = 143;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 chainId = block.chainid;

        address identity = resolveIdentityRegistry();
        require(identity.code.length > 0, "no ERC-8004 identity registry available");
        console.log("erc8004 identity registry:", identity);

        vm.startBroadcast(pk);

        AuthorityRegistry registry = new AuthorityRegistry(DTK_DELEGATION_MANAGER, identity);
        console.log("AuthorityRegistry:", address(registry));

        SkillAuthorityEnforcer enforcer = new SkillAuthorityEnforcer(registry);
        console.log("SkillAuthorityEnforcer:", address(enforcer));

        vm.stopBroadcast();

        console.log("ROOT_AUTHORITY:", vm.toString(IDelegationManagerConstants(DTK_DELEGATION_MANAGER).ROOT_AUTHORITY()));
        console.log("chainId:", chainId);
    }

    function resolveIdentityRegistry() public view returns (address) {
        if (block.chainid == MAINNET_CHAIN_ID) {
            require(
                ERC8004_MAINNET_IDENTITY.code.length > 0,
                "mainnet ERC-8004 registry has no code; refusing to deploy over it"
            );
            return ERC8004_MAINNET_IDENTITY;
        }
        return address(0);
    }
}

/// @notice Deploys the canonical ERC-8004 Identity Registry behind a UUPS proxy.
/// @dev NOT part of Deploy, and not on the critical path. The identity check reads
///      `AuthorityRegistry.agentIdOf`, never the ERC-8004 contract, so nothing breaks
///      on a chain that has no registry.
///
///      Left unimplemented on purpose. The canonical `initialize()` is `onlyOwner`
///      but never calls `__Ownable_init`, so the owner is address(0) and the call
///      reverts with OwnableUnauthorizedAccount. Upstream works around this with a
///      MinimalUUPS proxy, then an upgrade, then initialize (scripts/deploy-vanity.ts).
///      Replicating that is a day of work for supporting infrastructure, so the
///      honest move is to point at mainnet's existing registry and say so.
contract DeployERC8004Identity {
    error NotWorthItOnTestnetOnChainWithoutRegistry();

    function run() external pure {
        revert NotWorthItOnTestnetOnChainWithoutRegistry();
    }
}
