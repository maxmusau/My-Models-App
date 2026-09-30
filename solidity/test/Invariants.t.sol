// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Token} from "../src/Token.sol";
import {Collection} from "../src/Collection.sol";

/// @dev Random-sequence (stateful) tests: the Solidity twin of tests/invariants.test.ts.

contract TokenHandler is Test {
    Token public t;
    address public admin;
    address[] public actors;
    uint256 public minted;
    uint256 public burned;

    constructor(Token t_, address admin_) {
        t = t_;
        admin = admin_;
        actors.push(makeAddr("a1"));
        actors.push(makeAddr("a2"));
        actors.push(makeAddr("a3"));
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _a(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function mint(uint256 to, uint96 amount) external {
        vm.prank(admin);
        t.mint(_a(to), amount);
        minted += amount;
    }

    function burn(uint256 from, uint96 amount) external {
        address a = _a(from);
        amount = uint96(bound(amount, 0, t.balanceOf(a)));
        vm.prank(a);
        t.burn(amount);
        burned += amount;
    }

    function transfer(uint256 from, uint256 to, uint96 amount) external {
        address a = _a(from);
        amount = uint96(bound(amount, 0, t.balanceOf(a)));
        vm.prank(a);
        t.transfer(_a(to), amount);
    }

    function approve(uint256 from, uint256 spender, uint96 amount) external {
        vm.prank(_a(from));
        t.approve(_a(spender), amount);
    }

    function transferFrom(uint256 spender, uint256 from, uint256 to, uint96 amount) external {
        address f = _a(from);
        amount = uint96(bound(amount, 0, t.allowance(f, _a(spender))));
        amount = uint96(bound(amount, 0, t.balanceOf(f)));
        vm.prank(_a(spender));
        t.transferFrom(f, _a(to), amount);
    }
}

contract TokenInvariantTest is Test {
    Token t;
    TokenHandler h;

    function setUp() public {
        address admin = makeAddr("admin");
        t = new Token("Gold", "GLD", admin);
        h = new TokenHandler(t, admin);
        targetContract(address(h));
    }

    function invariant_supplyEqualsSumOfBalances() public view {
        uint256 sum;
        for (uint256 i; i < h.actorCount(); i++) sum += t.balanceOf(h.actors(i));
        assertEq(t.totalSupply(), sum);
    }

    function invariant_supplyEqualsMintedMinusBurned() public view {
        assertEq(t.totalSupply(), h.minted() - h.burned());
    }
}

contract CollectionHandler is Test {
    Collection public c;
    address public admin;
    address[] public actors;

    constructor(Collection c_, address admin_) {
        c = c_;
        admin = admin_;
        actors.push(makeAddr("a1"));
        actors.push(makeAddr("a2"));
        actors.push(makeAddr("a3"));
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _a(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _id(uint256 seed) internal pure returns (uint256) {
        return (seed % 4) + 1; // a tiny id space forces collisions and re-mints
    }

    function mint(uint256 to, uint256 id) external {
        vm.prank(admin);
        try c.mint(_a(to), _id(id), "", address(0), 0) {} catch {}
    }

    function burn(uint256 caller, uint256 id) external {
        vm.prank(_a(caller));
        try c.burn(_id(id)) {} catch {}
    }

    function transfer(uint256 caller, uint256 from, uint256 to, uint256 id) external {
        vm.prank(_a(caller));
        try c.transferFrom(_a(from), _a(to), _id(id)) {} catch {}
    }

    function approve(uint256 caller, uint256 spender, uint256 id) external {
        vm.prank(_a(caller));
        try c.approve(_a(spender), _id(id)) {} catch {}
    }

    function setApprovalForAll(uint256 caller, uint256 operator, bool ok) external {
        vm.prank(_a(caller));
        try c.setApprovalForAll(_a(operator), ok) {} catch {}
    }
}

contract CollectionInvariantTest is Test {
    Collection c;
    CollectionHandler h;

    function setUp() public {
        address admin = makeAddr("admin");
        c = new Collection("Art", "ART", admin);
        h = new CollectionHandler(c, admin);
        targetContract(address(h));
    }

    function invariant_balancesSumToSupplyAndEqualLiveTokens() public view {
        uint256 sum;
        for (uint256 i; i < h.actorCount(); i++) sum += c.balanceOf(h.actors(i));
        uint256 live;
        for (uint256 id = 1; id <= 4; id++) if (c.exists(id)) live++;
        assertEq(c.totalSupply(), sum);
        assertEq(c.totalSupply(), live);
    }

    function invariant_noTokenIsApprovedToItsOwner() public view {
        for (uint256 id = 1; id <= 4; id++) {
            if (c.exists(id)) assertTrue(c.getApproved(id) != c.ownerOf(id));
        }
    }
}
