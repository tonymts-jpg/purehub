export type NavItem = { href: string; label: string };

export const publicNav: NavItem[] = [
  { href: "/", label: "首页" },
  { href: "/explore", label: "探索" },
  { href: "/channels", label: "频道" },
  { href: "/search", label: "搜索" }
];

export const accountNav: NavItem[] = [
  { href: "/favorites", label: "收藏" },
  { href: "/unlocked", label: "已解锁内容" },
  { href: "/likes", label: "喜欢" },
  { href: "/history", label: "浏览历史" },
  { href: "/orders", label: "订单" },
  { href: "/following", label: "关注" },
  { href: "/notifications", label: "通知" }
];

export const creatorNav: NavItem[] = [
  { href: "/dashboard", label: "博主工作台" },
  { href: "/dashboard/posts", label: "作品管理" },
  { href: "/dashboard/posts/new", label: "发布作品" },
  { href: "/dashboard/channels", label: "频道" },
  { href: "/dashboard/members", label: "会员" },
  { href: "/dashboard/wallet", label: "钱包与收入" }
];

export type SessionUserLike = {
  role?: string;
  creatorStatus?: string;
  status?: string;
};

export function isApprovedCreator(user: SessionUserLike | null): boolean {
  return user?.role === "creator" && user.creatorStatus === "approved" && user.status === "active";
}

export function canApplyAsCreator(user: SessionUserLike | null): boolean {
  return !isApprovedCreator(user);
}
