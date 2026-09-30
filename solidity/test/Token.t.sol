// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Token} from "../src/Token.sol";

contract TokenTest is Test {
    Token t;
    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address spender = makeAddr("spender");

    function setUp() public {
        t = new Token("Gold", "GLD", admin);
    }

    function test_mint_increasesBalanceAndSupply() public {
        vm.prank(admin);
        t.mint(alice, 100);
        assertEq(t.balanceOf(alice), 100);
        assertEq(t.totalSupply(), 100);
    }

    function test_mint_revertsForNonMinter() public {
        vm.expectRevert(Token.NotMinter.selector);
        vm.prank(alice);
        t.mint(alice, 1);
    }

    function test_mint_revertsForZeroAddress() public {
        vm.expectRevert(Token.InvalidAddress.selector);
        vm.prank(admin);
        t.mint(address(0), 1);
    }

    function test_transfer_movesFunds() public {
        _fund(alice, 100);
        vm.prank(alice);
        t.transfer(bob, 40);
        assertEq(t.balanceOf(alice), 60);
        assertEq(t.balanceOf(bob), 40);
        assertEq(t.totalSupply(), 100);
    }

    function test_transfer_overdraftReverts() public {
        _fund(alice, 10);
        vm.expectRevert(Token.InsufficientBalance.selector);
        vm.prank(alice);
        t.transfer(bob, 11);
        assertEq(t.balanceOf(alice), 10);
    }

    function test_burn_decreasesSupply() public {
        _fund(alice, 10);
        vm.prank(alice);
        t.burn(4);
        assertEq(t.balanceOf(alice), 6);
        assertEq(t.totalSupply(), 6);
        vm.expectRevert(Token.InsufficientBalance.selector);
        vm.prank(alice);
        t.burn(7);
    }

    function test_transferFrom_consumesAllowance() public {
        _fund(alice, 100);
        vm.prank(alice);
        t.approve(spender, 30);
        vm.prank(spender);
        t.transferFrom(alice, bob, 20);
        assertEq(t.allowance(alice, spender), 10);
        assertEq(t.balanceOf(bob), 20);
        vm.expectRevert(Token.InsufficientAllowance.selector);
        vm.prank(spender);
        t.transferFrom(alice, bob, 11);
    }

    function test_transferFrom_doesNotSpendAllowanceOnInsufficientBalance() public {
        _fund(alice, 5);
        vm.prank(alice);
        t.approve(spender, 50);
        vm.expectRevert(Token.InsufficientBalance.selector);
        vm.prank(spender);
        t.transferFrom(alice, bob, 10);
        assertEq(t.allowance(alice, spender), 50);
    }

    function test_zeroAmountTransferFromWithoutApproval() public {
        vm.prank(alice);
        t.transferFrom(alice, alice, 0); // regression: bug found by the TypeScript property test
        assertEq(t.allowance(alice, alice), 0);
    }

    /// @dev Supply is conserved by any transfer, and balances add up.
    function testFuzz_transferConservesSupply(uint128 minted, uint128 sent) public {
        _fund(alice, minted);
        vm.prank(alice);
        try t.transfer(bob, sent) {
            assertEq(t.balanceOf(alice) + t.balanceOf(bob), minted);
        } catch {
            assertGt(sent, minted);
            assertEq(t.balanceOf(alice), minted);
        }
        assertEq(t.totalSupply(), minted);
    }

    function _fund(address to, uint256 amount) internal {
        vm.prank(admin);
        t.mint(to, amount);
    }
}
