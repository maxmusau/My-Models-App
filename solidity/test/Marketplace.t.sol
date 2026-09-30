// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Token} from "../src/Token.sol";
import {Collection} from "../src/Collection.sol";
import {Marketplace} from "../src/Marketplace.sol";

contract MarketplaceTest is Test {
    Token ft;
    Collection nft;
    Marketplace m;
    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address artist = makeAddr("artist");
    address treasury = makeAddr("treasury");

    function setUp() public {
        ft = new Token("Gold", "GLD", admin);
        nft = new Collection("Art", "ART", admin);
        m = new Marketplace(ft, nft, treasury, 250);

        vm.startPrank(admin);
        nft.mint(alice, 1, "ipfs://1", artist, 500);
        ft.mint(bob, 10_000);
        vm.stopPrank();

        vm.prank(bob);
        ft.approve(address(m), 10_000);
    }

    function _listToken1(uint256 price) internal {
        vm.startPrank(alice);
        nft.approve(address(m), 1);
        m.list(1, price);
        vm.stopPrank();
    }

    function test_buy_splitsFeeRoyaltyAndProceeds() public {
        _listToken1(1000);
        vm.prank(bob);
        m.buy(1);
        assertEq(nft.ownerOf(1), bob);
        assertEq(ft.balanceOf(treasury), 25);
        assertEq(ft.balanceOf(artist), 50);
        assertEq(ft.balanceOf(alice), 925);
        assertEq(ft.balanceOf(bob), 9000);
        assertEq(ft.allowance(bob, address(m)), 9000); // exactly the price was spent
        assertEq(m.getListing(1).seller, address(0));
    }

    function test_buy_operatorApprovalAndNoRoyalty() public {
        vm.prank(admin);
        nft.mint(alice, 2, "", address(0), 0);
        vm.startPrank(alice);
        nft.setApprovalForAll(address(m), true);
        m.list(2, 1000);
        vm.stopPrank();
        vm.prank(bob);
        m.buy(2);
        assertEq(ft.balanceOf(treasury), 25);
        assertEq(ft.balanceOf(alice), 975);
    }

    function test_list_requiresOwnershipApprovalPriceAndNoDuplicate() public {
        vm.expectRevert(Marketplace.NotOwner.selector);
        vm.prank(bob);
        m.list(1, 100);

        vm.expectRevert(Marketplace.MarketNotApproved.selector);
        vm.prank(alice);
        m.list(1, 100);

        vm.prank(alice);
        nft.approve(address(m), 1);
        vm.expectRevert(Marketplace.InvalidPrice.selector);
        vm.prank(alice);
        m.list(1, 0);

        vm.prank(alice);
        m.list(1, 100);
        vm.expectRevert(Marketplace.AlreadyListed.selector);
        vm.prank(alice);
        m.list(1, 100);
    }

    function test_buy_rejectsMissingAllowanceBrokeBuyerUnlistedAndSelfPurchase() public {
        vm.prank(bob);
        vm.expectRevert(Marketplace.NotListed.selector);
        m.buy(1);

        _listToken1(20_000);
        vm.prank(carol);
        vm.expectRevert(Marketplace.InsufficientAllowance.selector);
        m.buy(1);

        vm.prank(bob);
        ft.approve(address(m), 20_000);
        vm.prank(bob);
        vm.expectRevert(Marketplace.InsufficientBalance.selector);
        m.buy(1);

        vm.prank(alice);
        vm.expectRevert(Marketplace.SelfPurchase.selector);
        m.buy(1);

        assertEq(nft.ownerOf(1), alice);
        assertEq(ft.balanceOf(bob), 10_000);
    }

    function test_cancel_onlySeller() public {
        _listToken1(100);
        vm.expectRevert(Marketplace.NotOwner.selector);
        vm.prank(bob);
        m.cancel(1);
        vm.prank(alice);
        m.cancel(1);
        vm.expectRevert(Marketplace.NotListed.selector);
        vm.prank(bob);
        m.buy(1);
        vm.expectRevert(Marketplace.NotListed.selector);
        vm.prank(alice);
        m.cancel(1);
    }

    function test_listingDiesWhenSellerTransfersAway() public {
        _listToken1(100);
        vm.prank(alice);
        nft.transferFrom(alice, carol, 1);
        assertEq(m.getListing(1).seller, address(0));
        vm.expectRevert(Marketplace.NotListed.selector);
        vm.prank(bob);
        m.buy(1);
    }

    function test_listingDiesWhenApprovalRevoked() public {
        _listToken1(100);
        vm.prank(alice);
        nft.approve(address(0), 1);
        vm.expectRevert(Marketplace.MarketNotApproved.selector);
        vm.prank(bob);
        m.buy(1);
    }

    function test_constructorRejectsBadFee() public {
        vm.expectRevert(Marketplace.InvalidBps.selector);
        new Marketplace(ft, nft, treasury, 1001);
    }

    /// @dev Rounding never leaks value: fee + royalty + seller == price, for any price and rates.
    function testFuzz_quoteSumsToPrice(uint128 price, uint16 feeBps, uint16 royaltyBps) public {
        feeBps = uint16(bound(feeBps, 0, 1000));
        royaltyBps = uint16(bound(royaltyBps, 0, 1000));
        Marketplace mk = new Marketplace(ft, nft, treasury, feeBps);
        vm.prank(admin);
        nft.mint(alice, 77, "", artist, royaltyBps);
        (uint256 fee, uint256 royalty, uint256 seller,) = mk.quote(77, price);
        assertEq(fee + royalty + seller, price);
    }

    /// @dev A buy either succeeds completely or changes nothing; FT supply is always conserved.
    function testFuzz_buyIsAtomicAndConservesSupply(uint96 price, uint96 funds) public {
        price = uint96(bound(price, 1, type(uint96).max));
        address buyer = makeAddr("fuzzBuyer");
        vm.prank(admin);
        ft.mint(buyer, funds);
        vm.prank(buyer);
        ft.approve(address(m), funds);
        _listToken1(price);

        uint256 supply = ft.totalSupply();
        vm.prank(buyer);
        try m.buy(1) {
            assertEq(nft.ownerOf(1), buyer);
            assertGe(funds, price);
        } catch {
            assertLt(funds, price);
            assertEq(nft.ownerOf(1), alice);
            assertEq(ft.balanceOf(buyer), funds);
        }
        assertEq(ft.totalSupply(), supply);
        assertEq(nft.totalSupply(), 1);
    }
}
