// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Collection} from "../src/Collection.sol";

contract CollectionTest is Test {
    Collection c;
    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address spender = makeAddr("spender");
    address mallory = makeAddr("mallory");
    address artist = makeAddr("artist");

    function setUp() public {
        c = new Collection("Art", "ART", admin);
        vm.prank(admin);
        c.mint(alice, 1, "ipfs://one", artist, 500);
    }

    function test_mint_setsOwnerUriRoyalty() public view {
        assertEq(c.ownerOf(1), alice);
        assertEq(c.tokenURI(1), "ipfs://one");
        assertEq(c.totalSupply(), 1);
        assertEq(c.balanceOf(alice), 1);
        (address r, uint16 bps) = c.royaltyInfo(1);
        assertEq(r, artist);
        assertEq(bps, 500);
    }

    function test_mint_rejectsDuplicatesNonMintersAndBadRoyalty() public {
        vm.startPrank(admin);
        vm.expectRevert(Collection.TokenExists.selector);
        c.mint(bob, 1, "", address(0), 0);
        vm.expectRevert(Collection.InvalidBps.selector);
        c.mint(bob, 2, "", artist, 1001);
        vm.expectRevert(Collection.InvalidBps.selector);
        c.mint(bob, 2, "", address(0), 100);
        vm.stopPrank();
        vm.expectRevert(Collection.NotMinter.selector);
        vm.prank(mallory);
        c.mint(mallory, 3, "", address(0), 0);
    }

    function test_ownerCanTransfer() public {
        vm.prank(alice);
        c.transferFrom(alice, bob, 1);
        assertEq(c.ownerOf(1), bob);
        assertEq(c.balanceOf(alice), 0);
        assertEq(c.balanceOf(bob), 1);
    }

    function test_strangerCannotTransfer() public {
        vm.expectRevert(Collection.NotOwnerNorApproved.selector);
        vm.prank(mallory);
        c.transferFrom(alice, mallory, 1);
        assertEq(c.ownerOf(1), alice);
    }

    function test_wrongFromReverts() public {
        vm.expectRevert(Collection.WrongOwner.selector);
        vm.prank(alice);
        c.transferFrom(bob, carol, 1);
    }

    function test_approvedSpenderTransfers_andApprovalIsCleared() public {
        vm.prank(alice);
        c.approve(spender, 1);
        assertEq(c.getApproved(1), spender);
        vm.prank(spender);
        c.transferFrom(alice, bob, 1);
        assertEq(c.ownerOf(1), bob);
        assertEq(c.getApproved(1), address(0));
        vm.expectRevert(Collection.NotOwnerNorApproved.selector);
        vm.prank(spender);
        c.transferFrom(bob, spender, 1);
    }

    function test_operatorCanApproveAndTransfer() public {
        vm.prank(alice);
        c.setApprovalForAll(spender, true);
        vm.startPrank(spender);
        c.approve(carol, 1);
        c.transferFrom(alice, bob, 1);
        vm.stopPrank();
        assertEq(c.ownerOf(1), bob);
    }

    function test_onlyOwnerOrOperatorCanApprove() public {
        vm.expectRevert(Collection.NotOwnerNorApproved.selector);
        vm.prank(mallory);
        c.approve(mallory, 1);
    }

    function test_burn_removesTokenAndIdCanBeReminted() public {
        vm.prank(alice);
        c.burn(1);
        assertFalse(c.exists(1));
        assertEq(c.totalSupply(), 0);
        vm.expectRevert(Collection.TokenNotFound.selector);
        c.ownerOf(1);
        vm.prank(admin);
        c.mint(bob, 1, "", address(0), 0);
        assertEq(c.ownerOf(1), bob);
        (address r,) = c.royaltyInfo(1);
        assertEq(r, address(0)); // old royalty does not leak into the new token
    }

    function test_unknownTokenReverts() public {
        vm.expectRevert(Collection.TokenNotFound.selector);
        vm.prank(alice);
        c.transferFrom(alice, bob, 99);
    }
}
