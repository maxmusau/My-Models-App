// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Non-fungible token collection with royalties. Mirrors src/core/nftRegistry.ts.
contract Collection {
    error NotMinter();
    error InvalidAddress();
    error TokenExists();
    error TokenNotFound();
    error NotOwnerNorApproved();
    error WrongOwner();
    error SelfApproval();
    error InvalidBps();

    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    event Approval(address indexed owner, address indexed approved, uint256 indexed id);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    uint16 public constant MAX_ROYALTY_BPS = 1000; // 10%

    string public name;
    string public symbol;
    uint256 public totalSupply;

    mapping(address => bool) public isMinter;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _owners;
    mapping(uint256 => string) private _uris;
    mapping(uint256 => address) private _approvals;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    mapping(uint256 => address) private _royaltyReceiver;
    mapping(uint256 => uint16) private _royaltyBps;

    constructor(string memory name_, string memory symbol_, address minter) {
        name = name_;
        symbol = symbol_;
        isMinter[minter] = true;
    }

    function exists(uint256 id) public view returns (bool) {
        return _owners[id] != address(0);
    }

    function ownerOf(uint256 id) public view returns (address o) {
        o = _owners[id];
        if (o == address(0)) revert TokenNotFound();
    }

    function balanceOf(address a) external view returns (uint256) {
        return _balances[a];
    }

    function tokenURI(uint256 id) external view returns (string memory) {
        ownerOf(id);
        return _uris[id];
    }

    function getApproved(uint256 id) external view returns (address) {
        ownerOf(id);
        return _approvals[id];
    }

    /// @return receiver address(0) if the token has no royalty.
    function royaltyInfo(uint256 id) external view returns (address receiver, uint16 bps) {
        ownerOf(id);
        return (_royaltyReceiver[id], _royaltyBps[id]);
    }

    /// @param receiver address(0) means "no royalty" (then `bps` must be 0).
    function mint(address to, uint256 id, string calldata uri, address receiver, uint16 bps)
        external
    {
        if (!isMinter[msg.sender]) revert NotMinter();
        if (to == address(0)) revert InvalidAddress();
        if (exists(id)) revert TokenExists();
        if (bps > MAX_ROYALTY_BPS || (receiver == address(0) && bps != 0)) revert InvalidBps();

        _owners[id] = to;
        _uris[id] = uri;
        _balances[to] += 1;
        totalSupply += 1;
        if (receiver != address(0)) {
            _royaltyReceiver[id] = receiver;
            _royaltyBps[id] = bps;
        }
        emit Transfer(address(0), to, id);
    }

    function burn(uint256 id) external {
        address owner = ownerOf(id);
        _requireAuthorized(msg.sender, owner, id);
        delete _owners[id];
        delete _uris[id];
        delete _approvals[id];
        delete _royaltyReceiver[id];
        delete _royaltyBps[id];
        _balances[owner] -= 1;
        totalSupply -= 1;
        emit Transfer(owner, address(0), id);
    }

    function transferFrom(address from, address to, uint256 id) external {
        if (to == address(0)) revert InvalidAddress();
        address owner = ownerOf(id);
        if (owner != from) revert WrongOwner();
        _requireAuthorized(msg.sender, owner, id);
        delete _approvals[id];
        _owners[id] = to;
        _balances[from] -= 1;
        _balances[to] += 1;
        emit Transfer(from, to, id);
    }

    /// @param spender address(0) clears the approval.
    function approve(address spender, uint256 id) external {
        address owner = ownerOf(id);
        if (msg.sender != owner && !isApprovedForAll[owner][msg.sender]) {
            revert NotOwnerNorApproved();
        }
        if (spender == owner) revert SelfApproval();
        _approvals[id] = spender;
        emit Approval(owner, spender, id);
    }

    function setApprovalForAll(address operator, bool approved) external {
        if (operator == address(0)) revert InvalidAddress();
        if (operator == msg.sender) revert SelfApproval();
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function _requireAuthorized(address caller, address owner, uint256 id) internal view {
        if (caller != owner && _approvals[id] != caller && !isApprovedForAll[owner][caller]) {
            revert NotOwnerNorApproved();
        }
    }
}
