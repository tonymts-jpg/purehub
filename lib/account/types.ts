import type { Post } from "@/lib/types";
import type { ChannelListItemDto } from "@/lib/channels/types";

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

export type AccountPostListItem = {
  post: Post;
  creator: AccountPostCreator;
  occurredAt: string;
};

export type AccountPostCreator = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
};

export type AccountChannelFavoriteListItem = {
  channel: ChannelListItemDto & { bookmarked: true };
  occurredAt: string;
};

export type AccountFollowingCreator = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  bio: string | null;
  category: string | null;
  verified: boolean;
  following: true;
};

export type AccountFollowingListItem = {
  creator: AccountFollowingCreator;
  occurredAt: string;
};

export type AccountUnlockedSource = "purchase" | "subscription";

export type AccountUnlockedListItem = {
  post: Post;
  creator: AccountPostCreator;
  source: AccountUnlockedSource;
  occurredAt: string;
};

export type BuyerOrderCreator = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
};

export type BuyerOrderListItem = {
  id: string;
  kind: string;
  itemId: string;
  itemLabel: string | null;
  amount: number;
  currency: string;
  status: string;
  provider: string | null;
  createdAt: string;
  paidAt: string | null;
  creator: BuyerOrderCreator;
};
