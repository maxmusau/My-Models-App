export type ErrorCode =
  | "InvalidAmount"
  | "InvalidAddress"
  | "InsufficientBalance"
  | "InsufficientAllowance"
  | "NotMinter"
  | "TokenExists"
  | "TokenNotFound"
  | "NotOwnerNorApproved"
  | "NotOwner"
  | "WrongOwner"
  | "SelfApproval"
  | "InvalidPrice"
  | "InvalidBps"
  | "NotListed"
  | "AlreadyListed"
  | "MarketNotApproved"
  | "SelfPurchase"
  | "InvalidDuration"
  | "NoAuction"
  | "AuctionExists"
  | "AuctionEnded"
  | "AuctionNotEnded"
  | "BidTooLow"
  | "HasBids";

export class ModelError extends Error {
  constructor(public readonly code: ErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ModelError";
  }
}

export type Address = string;

export function assertAddress(a: Address): void {
  if (typeof a !== "string" || a.length === 0) throw new ModelError("InvalidAddress");
}
