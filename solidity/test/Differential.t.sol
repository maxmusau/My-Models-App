// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Token} from "../src/Token.sol";
import {Collection} from "../src/Collection.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// @notice Differential test: replays the random scenarios recorded from the TypeScript model
/// (test/fixtures/scenarios.json, made by `npm run diff:gen`) against the real contracts.
/// For every step the contracts must succeed or revert exactly as the model did, and after each
/// scenario the whole observable state must match. Layout of a step and of the state vector is
/// defined in src/differential.ts; keep the two in sync.
contract DifferentialTest is Test {
    uint256 constant ROW = 7;
    uint256 constant NONE = 7;
    uint256 constant MAX_ID = 4;

    Token ft;
    Collection nft;
    Marketplace m;
    // 0 admin, 1 alice, 2 bob, 3 carol, 4 market, 5 treasury, 6 artist, 7 nobody
    address[8] A;

    function test_contractsMatchTypeScriptModel() public {
        string memory json = vm.readFile("test/fixtures/scenarios.json");
        uint256 count = vm.parseJsonUint(json, ".count");
        assertGt(count, 0, "empty fixture: run `npm run diff:gen`");
        assertEq(vm.parseJsonUint(json, ".row"), ROW, "fixture layout changed");

        for (uint256 i = 0; i < count; i++) {
            _fresh();
            uint256[] memory rows = vm.parseJsonUintArray(json, string.concat(".s", vm.toString(i)));
            uint256 steps = rows.length / ROW;
            for (uint256 k = 0; k < steps; k++) {
                bool expectedOk = rows[k * ROW + 6] == 1;
                bool ok = _step(rows, k * ROW);
                if (ok != expectedOk) {
                    revert(
                        string.concat(
                            "MISMATCH scenario ",
                            vm.toString(i),
                            " step ",
                            vm.toString(k),
                            " op ",
                            vm.toString(rows[k * ROW]),
                            ": model ",
                            expectedOk ? "succeeded" : "rejected",
                            ", contract ",
                            ok ? "succeeded" : "reverted"
                        )
                    );
                }
            }
            _compareState(vm.parseJsonUintArray(json, string.concat(".e", vm.toString(i))), i);
        }
    }

    function _fresh() internal {
        A[0] = makeAddr("admin");
        A[1] = makeAddr("alice");
        A[2] = makeAddr("bob");
        A[3] = makeAddr("carol");
        A[5] = makeAddr("treasury");
        A[6] = makeAddr("artist");
        A[7] = address(0);
        ft = new Token("Gold", "GLD", A[0]);
        nft = new Collection("Art", "ART", A[0]);
        m = new Marketplace(ft, nft, A[5], 250);
        A[4] = address(m);
    }

    /// @dev Runs one step as its caller. Returns whether the call succeeded.
    function _step(uint256[] memory r, uint256 o) internal returns (bool ok) {
        uint256 op = r[o];
        address caller = A[r[o + 1]];
        uint256 a = r[o + 2];
        uint256 b = r[o + 3];
        uint256 c = r[o + 4];
        uint256 d = r[o + 5];

        vm.startPrank(caller);
        if (op == 0) {
            try ft.mint(A[a], b) { ok = true; } catch {}
        } else if (op == 1) {
            try ft.burn(a) { ok = true; } catch {}
        } else if (op == 2) {
            try ft.transfer(A[a], b) returns (bool) { ok = true; } catch {}
        } else if (op == 3) {
            try ft.approve(A[a], b) returns (bool) { ok = true; } catch {}
        } else if (op == 4) {
            try ft.transferFrom(A[a], A[b], c) returns (bool) { ok = true; } catch {}
        } else if (op == 5) {
            address receiver = c == NONE ? address(0) : A[c];
            try nft.mint(A[a], b, "", receiver, uint16(d)) { ok = true; } catch {}
        } else if (op == 6) {
            try nft.burn(a) { ok = true; } catch {}
        } else if (op == 7) {
            try nft.transferFrom(A[a], A[b], c) { ok = true; } catch {}
        } else if (op == 8) {
            try nft.approve(A[a], b) { ok = true; } catch {}
        } else if (op == 9) {
            try nft.setApprovalForAll(A[a], b == 1) { ok = true; } catch {}
        } else if (op == 10) {
            try m.list(a, b) { ok = true; } catch {}
        } else if (op == 11) {
            try m.cancel(a) { ok = true; } catch {}
        } else if (op == 12) {
            try m.buy(a) { ok = true; } catch {}
        } else {
            revert("unknown op");
        }
        vm.stopPrank();
    }

    function _idx(address who) internal view returns (uint256) {
        for (uint256 i = 0; i < 7; i++) if (A[i] == who) return i;
        return NONE;
    }

    /// @dev Builds the state vector in exactly the order documented in src/differential.ts.
    function _compareState(uint256[] memory e, uint256 scenario) internal view {
        uint256[] memory v = new uint256[](e.length);
        uint256 p;
        for (uint256 i = 0; i < 7; i++) v[p++] = ft.balanceOf(A[i]);
        for (uint256 i = 0; i < 7; i++) v[p++] = nft.balanceOf(A[i]);
        v[p++] = ft.totalSupply();
        v[p++] = nft.totalSupply();
        for (uint256 id = 1; id <= MAX_ID; id++) {
            bool exists = nft.exists(id);
            v[p++] = exists ? 1 : 0;
            v[p++] = exists ? _idx(nft.ownerOf(id)) : NONE;
            v[p++] = exists ? _idx(nft.getApproved(id)) : NONE;
            (address recv, uint16 bps) = exists ? nft.royaltyInfo(id) : (address(0), uint16(0));
            v[p++] = _idx(recv);
            v[p++] = bps;
            Marketplace.Listing memory l = m.getListing(id);
            v[p++] = _idx(l.seller);
            v[p++] = l.price;
        }
        for (uint256 i = 0; i < 7; i++) for (uint256 j = 0; j < 7; j++) v[p++] = ft.allowance(A[i], A[j]);
        for (uint256 i = 0; i < 7; i++) for (uint256 j = 0; j < 7; j++) v[p++] = nft.isApprovedForAll(A[i], A[j]) ? 1 : 0;

        require(p == e.length, "state vector length differs from the model's");
        for (uint256 k = 0; k < p; k++) {
            if (v[k] != e[k]) {
                revert(
                    string.concat(
                        "STATE MISMATCH scenario ",
                        vm.toString(scenario),
                        " at state index ",
                        vm.toString(k),
                        ": model ",
                        vm.toString(e[k]),
                        ", contract ",
                        vm.toString(v[k])
                    )
                );
            }
        }
    }
}
