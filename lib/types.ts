import type { ContentCategory } from "./categories";

export type Role = "fan" | "creator";
export type Visibility = "free" | "members" | "purchase";

export interface User {
  id: string; name: string; handle: string; avatar: string; role: Role;
}
export interface MembershipPlan {
  id: string; name: string; price: number; color: string; benefits: string[];
}
export interface CreatorProfile extends User {
  bio: string; category: ContentCategory; followers: number; members: number; cover: string;
  verified: boolean; plans: MembershipPlan[];
}
export interface Comment { id: string; user: string; text: string; time: string; }
export interface MediaAsset {
  id: string; src: string; alt: string; width: number; height: number; order: number;
}
export interface Post {
  id: string; creatorId: string; title: string; excerpt: string; content: string;
  cover: string; category: ContentCategory; tags: string[]; visibility: Visibility;
  price?: number; likes: number; comments: Comment[]; createdAt: string; media: MediaAsset[];
}
export interface Product { id: string; creatorId: string; title: string; price: number; cover: string; }
export interface Subscription { id: string; creatorId: string; planId: string; startedAt: string; }
export interface Entitlement { id: string; postId: string; source: "subscription" | "purchase"; }
export interface Transaction { id: string; title: string; amount: number; type: "income" | "payout"; date: string; status: string; }
export interface WalletBalance { available: number; pending: number; reserved: number; debt: number; currency: "CNY"; }
export interface Notification { id: string; title: string; body: string; time: string; read: boolean; type: string; }
export interface DemoSession { role: Role; theme: "light" | "dark"; }
