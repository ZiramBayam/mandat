// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import {Delegation} from "delegation-framework/utils/Types.sol";
import {ERC1271Lib} from "delegation-framework/libraries/ERC1271Lib.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @dev The two members of DelegationManager we need. Kept minimal on purpose:
///      importing the concrete contract would pull its whole dependency graph in,
///      and `ROOT_AUTHORITY` is not exposed on DTK's own interface.
interface IDelegationManagerConstants {
    function ROOT_AUTHORITY() external view returns (bytes32);
    function getDomainHash() external view returns (bytes32);
    function getDelegationHash(Delegation calldata input) external pure returns (bytes32);
}

/// @dev The ERC-8004 Identity Registry is an ERC-721. We only read `ownerOf`.
interface IERC8004Identity {
    function ownerOf(uint256 agentId) external view returns (address);
}


/// @notice On-chain record of who authorised what, and through whom.
/// @dev Attribution has to be readable by anyone without a server we run. If the
///      only copy lived in an indexer we would be the platform capturing the value,
///      which is exactly what Track 04 is about.
///      Registration is permissionless but self-validating: the registry checks the
///      delegation's own signature, so anyone may submit one but nobody may forge one.
///      Revocation stays with the delegator, because withdrawing authority is the
///      delegator's right, not the platform's.
contract AuthorityRegistry {
    struct AuthorityMeta {
        address delegator;
        address delegate;
        uint256 agentId;
        bytes32 parentHash;
        bytes32 manifestHash;
        uint64 createdAt;
        uint64 revokedAt;
    }

    /// @notice delegationHash => record. Readable with a plain eth_call.
    mapping(bytes32 => AuthorityMeta) public authorities;

    /// @notice digest of an approved consent document, and whether it is still live.
    mapping(bytes32 => bool) public liveManifests;

    /// @notice digest => content id, so a reader can resolve the document a human approved.
    mapping(bytes32 => string) public manifestCid;

    /// @notice redeemer address => ERC-8004 agent id. 0 means not yet bound.
    mapping(address => uint256) public agentIdOf;

    /// @notice parent delegationHash => direct children.
    mapping(bytes32 => bytes32[]) private _descendants;

    /// @notice cumulative count, for the demo panel.
    uint256 public delegationCount;

    IDelegationManagerConstants public immutable DELEGATION_MANAGER;

    /// @dev DTK's sentinel for "no parent". Cached at construction, asserted in tests.
    bytes32 public immutable ROOT_AUTHORITY;

    /// @dev Set only where an ERC-8004 Identity Registry exists, which today means
    ///      Monad mainnet. Zero on testnet. The identity check reads `agentIdOf`,
    ///      never this, so a missing registry never disables enforcement.
    address public immutable ERC8004_IDENTITY;

    error DelegationAlreadyRegistered();
    error AgentIdMustBeNonZero();
    error AgentAlreadyBound(uint256 existing);
    error NoERC8004Registry();
    error ParentNotRegistered();
    error RootAuthorityRequired();
    error InvalidEOASignature();
    error InvalidERC1271Signature();
    error NotYourDelegation();
    error AlreadyRevoked();
    error UnknownDelegation();

    event AuthorityRegistered(bytes32 indexed delegationHash, address indexed delegator, address indexed delegate);
    event AuthorityRevoked(bytes32 indexed delegationHash, address indexed delegator);
    event ManifestRegistered(bytes32 indexed manifestHash, string cid);
    event ManifestRevoked(bytes32 indexed manifestHash);
    event AgentBound(address indexed agent, uint256 indexed agentId);

    constructor(address delegationManager, address erc8004Identity) {
        DELEGATION_MANAGER = IDelegationManagerConstants(delegationManager);
        ROOT_AUTHORITY = DELEGATION_MANAGER.ROOT_AUTHORITY();
        ERC8004_IDENTITY = erc8004Identity;
    }

    /* ------------------------------------------------------------------ */
    /* Registration                                                        */
    /* ------------------------------------------------------------------ */

    /// @notice Record a delegation anyone can submit but nobody can forge.
    /// @dev The signature is verified against the domain the DelegationManager itself
    ///      uses, so a delegation that DTK would accept is exactly one we accept.
    function registerDelegation(Delegation calldata delegation, bytes32 manifestHash) external {
        bytes32 delegationHash = DELEGATION_MANAGER.getDelegationHash(delegation);
        if (authorities[delegationHash].delegator != address(0)) revert DelegationAlreadyRegistered();

        bytes32 typedHash = _typedHash(delegationHash);
        address delegator = delegation.delegator;

        if (delegator.code.length == 0) {
            address recovered = ECDSA.recover(typedHash, delegation.signature);
            if (recovered != delegator) revert InvalidEOASignature();
        } else {
            bytes4 magic = IERC1271(delegator).isValidSignature(typedHash, delegation.signature);
            if (magic != ERC1271Lib.EIP1271_MAGIC_VALUE) revert InvalidERC1271Signature();
        }

        if (delegation.authority == ROOT_AUTHORITY) {
            // Root has no parent, which is exactly what ROOT_AUTHORITY means.
        } else if (!_isKnown(delegation.authority)) {
            revert ParentNotRegistered();
        }

        authorities[delegationHash] = AuthorityMeta({
            delegator: delegator,
            delegate: delegation.delegate,
            agentId: agentIdOf[delegation.delegate],
            parentHash: delegation.authority,
            manifestHash: manifestHash,
            createdAt: uint64(block.timestamp),
            revokedAt: 0
        });

        if (delegation.authority != ROOT_AUTHORITY) {
            _descendants[delegation.authority].push(delegationHash);
        }
        unchecked {
            ++delegationCount;
        }

        emit AuthorityRegistered(delegationHash, delegator, delegation.delegate);
    }

    /// @notice Bind an address to an agent id, asserting it against ERC-8004.
    /// @dev This is the mainnet path. The id is only accepted if the real
    ///      Identity Registry says the caller owns that agent, so a bound id
    ///      cannot be invented here.
    function bindAgentFromERC8004(uint256 agentId) external {
        address registry = ERC8004_IDENTITY;
        require(registry != address(0), "no ERC-8004 registry on this chain; use bindAgent");
        require(IERC8004Identity(registry).ownerOf(agentId) == msg.sender, "caller does not own that agent");
        agentIdOf[msg.sender] = agentId;
        emit AgentBound(msg.sender, agentId);
    }

    /// @notice Bind an address to an agent id without an ERC-8004 check.
    /// @dev For chains that have no ERC-8004 registry, which today is testnet.
    ///      Still not a free pass: the id must be one nobody else has bound, and
    ///      rebinding to a different id is refused, so the mapping cannot be churned
    ///      to dodge a later check.
    function bindAgent(address agent, uint256 agentId) external {
        require(agentId != 0, "agentId must be non-zero");
        uint256 existing = agentIdOf[agent];
        require(existing == 0 || existing == agentId, "agent already bound to a different id");
        agentIdOf[agent] = agentId;
        emit AgentBound(agent, agentId);
    }

    /// @notice Publish a consent document so delegations may reference it.
    function registerManifest(bytes32 manifestHash, string calldata cid) external {
        liveManifests[manifestHash] = true;
        manifestCid[manifestHash] = cid;
        emit ManifestRegistered(manifestHash, cid);
    }

    /* ------------------------------------------------------------------ */
    /* Revocation                                                          */
    /* ------------------------------------------------------------------ */

    /// @notice Withdraw one delegation and everything below it.
    /// @dev Marking the whole subtree is what makes a withdrawn root unusable
    ///      through any path, including one registered long after the fact.
    function revokeDelegation(bytes32 delegationHash) external {
        AuthorityMeta storage meta = authorities[delegationHash];
        if (meta.delegator == address(0)) revert UnknownDelegation();
        if (meta.delegator != msg.sender) revert NotYourDelegation();
        _revokeSubtree(delegationHash, meta);
    }

    /// @notice Kill every delegation bound to a consent document, in one call.
    /// @dev No iteration needed: enforcers read liveManifests, not the per-delegation rows.
    function revokeManifest(bytes32 manifestHash) external {
        liveManifests[manifestHash] = false;
        emit ManifestRevoked(manifestHash);
    }

    function _revokeSubtree(bytes32 delegationHash, AuthorityMeta storage meta) private {
        if (meta.revokedAt != 0) revert AlreadyRevoked();
        meta.revokedAt = uint64(block.timestamp);
        emit AuthorityRevoked(delegationHash, meta.delegator);

        bytes32[] storage children = _descendants[delegationHash];
        for (uint256 i = 0; i < children.length; ++i) {
            bytes32 child = children[i];
            AuthorityMeta storage childMeta = authorities[child];
            if (childMeta.delegator != address(0) && childMeta.revokedAt == 0) {
                _revokeSubtree(child, childMeta);
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Views                                                               */
    /* ------------------------------------------------------------------ */

    function isRegistered(bytes32 delegationHash) external view returns (bool) {
        return authorities[delegationHash].delegator != address(0);
    }

    /// @notice True only when this hop and every ancestor are still authorised.
    function isLive(bytes32 delegationHash) external view returns (bool) {
        bytes32 cursor = delegationHash;
        // Bounded on purpose. A cycle is impossible because a parent must be
        // registered before its child, but the bound is cheap insurance.
        for (uint256 depth = 0; depth < MAX_LINEAGE; ++depth) {
            AuthorityMeta storage meta = authorities[cursor];
            if (meta.delegator == address(0) || meta.revokedAt != 0) return false;
            if (meta.parentHash == ROOT_AUTHORITY) return true;
            cursor = meta.parentHash;
        }
        revert ParentNotRegistered();
    }

    /// @notice Root to leaf. The answer to "who authorised this, through whom".
    function lineage(bytes32 delegationHash) external view returns (AuthorityMeta[] memory chain) {
        bytes32 cursor = delegationHash;
        uint256 count;
        while (true) {
            AuthorityMeta storage meta = authorities[cursor];
            if (meta.delegator == address(0)) break;
            unchecked {
                ++count;
            }
            if (meta.parentHash == ROOT_AUTHORITY) break;
            cursor = meta.parentHash;
            if (count > MAX_LINEAGE) revert ParentNotRegistered();
        }

        chain = new AuthorityMeta[](count);
        cursor = delegationHash;
        for (uint256 i = count; i > 0; --i) {
            chain[i - 1] = authorities[cursor];
            if (authorities[cursor].parentHash != ROOT_AUTHORITY) {
                cursor = authorities[cursor].parentHash;
            }
        }
    }

    function descendantsOf(bytes32 delegationHash) external view returns (bytes32[] memory) {
        return _descendants[delegationHash];
    }

    /* ------------------------------------------------------------------ */
    /* Internals                                                           */
    /* ------------------------------------------------------------------ */

    uint256 internal constant MAX_LINEAGE = 16;

    function _isKnown(bytes32 hash) private view returns (bool) {
        return authorities[hash].delegator != address(0);
    }

    function _typedHash(bytes32 delegationHash) private view returns (bytes32) {
        return keccak256(
            abi.encodePacked("\x19\x01", DELEGATION_MANAGER.getDomainHash(), delegationHash)
        );
    }
}
