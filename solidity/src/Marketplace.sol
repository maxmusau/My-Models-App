// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Token} from "./Token.sol";
import {Collection} from "./Collection.sol";

/// @notice Fixed-price marketplace selling NFTs for FTs. Mirrors src/core/marketplace.ts.
/// Sellers must approve this contract for the NFT; buyers must give it an FT allowance >= price.
contract Marketplace {
    error InvalidPrice();
    error InvalidBps();
    error InvalidAddress();
    error NotOwner();
    error NotListed();
    error AlreadyListed();
    error MarketNotApproved();
    error SelfPurchase();
    error InsufficientAllowance();
    error InsufficientBalance();

    event Listed(uint256 indexed id, address indexed seller, uint256 price);
    event Cancelled(uint256 indexed id);
    event Sold(uint256 indexed id, address indexed buyer, uint256 fee, uint256 royalty, uint256 seller);

    uint256 public constant BPS = 10_000;
    uint16 public constant MAX_FEE_BPS = 1000; // 10%

    struct Listing {
        address seller;
        uint256 price;
    }

    Token public immutable ft;
    Collection public immutable nft;
    address public immutable treasury;
    uint16 public immutable feeBps;

    mapping(uint256 => Listing) private _listings;

    constructor(Token ft_, Collection nft_, address treasury_, uint16 feeBps_) {
        if (treasury_ == address(0)) revert InvalidAddress();
        if (feeBps_ > MAX_FEE_BPS) revert InvalidBps();
        ft = ft_;
        nft = nft_;
        treasury = treasury_;
        feeBps = feeBps_;
    }

    /// @notice Split of a sale. The three amounts always add up to exactly `price`.
    function quote(uint256 id, uint256 price)
        public
        view
        returns (uint256 fee, uint256 royalty, uint256 sellerAmount, address royaltyReceiver)
    {
        uint16 royaltyBps;
        (royaltyReceiver, royaltyBps) = nft.royaltyInfo(id);
        fee = (price * feeBps) / BPS;
        royalty = (price * royaltyBps) / BPS;
        sellerAmount = price - fee - royalty;
    }

    /// @return l the listing; seller is address(0) if there is no live listing.
    function getListing(uint256 id) public view returns (Listing memory l) {
        l = _listings[id];
        if (!_isLive(id, l)) delete l;
    }

    function list(uint256 id, uint256 price) external {
        if (price == 0) revert InvalidPrice();
        if (nft.ownerOf(id) != msg.sender) revert NotOwner();
        _requireApproved(msg.sender, id);
        if (getListing(id).seller != address(0)) revert AlreadyListed();
        _listings[id] = Listing(msg.sender, price);
        emit Listed(id, msg.sender, price);
    }

    function cancel(uint256 id) external {
        Listing memory l = _listings[id];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller != msg.sender) revert NotOwner();
        delete _listings[id];
        emit Cancelled(id);
    }

    function buy(uint256 id) external {
        Listing memory l = getListing(id);
        if (l.seller == address(0)) revert NotListed();
        if (msg.sender == l.seller) revert SelfPurchase();
        _requireApproved(l.seller, id);
        if (ft.allowance(msg.sender, address(this)) < l.price) revert InsufficientAllowance();
        if (ft.balanceOf(msg.sender) < l.price) revert InsufficientBalance();

        (uint256 fee, uint256 royalty, uint256 sellerAmount, address receiver) = quote(id, l.price);

        delete _listings[id]; // effects before interactions
        nft.transferFrom(l.seller, msg.sender, id);
        ft.transferFrom(msg.sender, treasury, fee);
        if (receiver != address(0)) ft.transferFrom(msg.sender, receiver, royalty);
        ft.transferFrom(msg.sender, l.seller, sellerAmount);
        emit Sold(id, msg.sender, fee, royalty, sellerAmount);
    }

    /// @dev A listing is live only while the seller still owns the token.
    function _isLive(uint256 id, Listing memory l) internal view returns (bool) {
        return l.seller != address(0) && nft.exists(id) && nft.ownerOf(id) == l.seller;
    }

    function _requireApproved(address owner, uint256 id) internal view {
        if (nft.getApproved(id) != address(this) && !nft.isApprovedForAll(owner, address(this))) {
            revert MarketNotApproved();
        }
    }
}
