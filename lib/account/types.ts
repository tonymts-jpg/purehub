export type AccountListScope =
  | "favorite-posts"
  | "favorite-channels"
  | "unlocked"
  | "likes"
  | "history"
  | "orders"
  | "following";

export type AccountCursor = {
  scope: AccountListScope;
  occurredAt: string;
  id: string;
};
