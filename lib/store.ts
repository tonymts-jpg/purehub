"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { posts as seedPosts, transactions as seedTransactions } from "./data";
import { Post, Role, Subscription, Transaction } from "./types";
import { migrateCategory } from "./categories";

type NewPost = Pick<Post,"title"|"excerpt"|"content"|"category"|"visibility">;
interface DemoStore {
  role: Role; theme: "light"|"dark"; liked: string[]; bookmarked: string[]; followed: string[];
  subscriptions: Subscription[]; unlocked: string[]; customPosts: Post[];
  transactions: Transaction[]; balance: number; toast: string | null;
  setRole:(role:Role)=>void; toggleTheme:()=>void; toggleLike:(id:string)=>void;
  toggleBookmark:(id:string)=>void; toggleFollow:(id:string)=>void;
  subscribe:(creatorId:string,planId:string)=>void; unlock:(postId:string,price:number)=>void;
  createPost:(post:NewPost)=>Post; payout:(amount:number)=>boolean; showToast:(message:string)=>void;
  clearToast:()=>void; reset:()=>void;
}

const initial = {
  role:"fan" as Role, theme:"light" as const, liked:[], bookmarked:[], followed:["c1","c3"],
  subscriptions:[] as Subscription[], unlocked:[] as string[], customPosts:[] as Post[],
  transactions:seedTransactions, balance:8620
};

export const useDemoStore = create<DemoStore>()(persist((set,get)=>({
  ...initial, toast:null,
  setRole:(role)=>set({role,toast:role==="creator"?"已切换至创作者视角":"已切换至粉丝视角"}),
  toggleTheme:()=>set(s=>({theme:s.theme==="light"?"dark":"light"})),
  toggleLike:(id)=>set(s=>({liked:s.liked.includes(id)?s.liked.filter(x=>x!==id):[...s.liked,id]})),
  toggleBookmark:(id)=>set(s=>({bookmarked:s.bookmarked.includes(id)?s.bookmarked.filter(x=>x!==id):[...s.bookmarked,id]})),
  toggleFollow:(id)=>set(s=>({followed:s.followed.includes(id)?s.followed.filter(x=>x!==id):[...s.followed,id]})),
  subscribe:(creatorId,planId)=>set(s=>({
    subscriptions:[...s.subscriptions.filter(x=>x.creatorId!==creatorId),{id:`sub-${Date.now()}`,creatorId,planId,startedAt:new Date().toISOString()}],
    transactions:[{id:`t-${Date.now()}`,title:"会员订阅",amount:-48,type:"payout",date:"刚刚",status:"支付成功"},...s.transactions],
    toast:"订阅成功，会员内容已解锁"
  })),
  unlock:(postId,price)=>set(s=>({unlocked:[...new Set([...s.unlocked,postId])],transactions:[{id:`t-${Date.now()}`,title:"购买数字内容",amount:-price,type:"payout",date:"刚刚",status:"支付成功"},...s.transactions],toast:"购买成功，内容已解锁"})),
  createPost:(input)=>{
    const post:Post={...input,id:`custom-${Date.now()}`,creatorId:"c1",cover:"cover-1",tags:[input.category,"新发布"],likes:0,comments:[],createdAt:"刚刚",media:[]};
    set(s=>({customPosts:[post,...s.customPosts],toast:"作品发布成功，已加入推荐动态"})); return post;
  },
  payout:(amount)=>{
    if(amount<100||amount>get().balance) return false;
    set(s=>({balance:s.balance-amount,transactions:[{id:`t-${Date.now()}`,title:"提现至支付宝",amount:-amount,type:"payout",date:"刚刚",status:"处理中"},...s.transactions],toast:"提现申请已提交"})); return true;
  },
  showToast:(toast)=>set({toast}), clearToast:()=>set({toast:null}),
  reset:()=>set({...initial,toast:"Demo 数据已重置"})
}),{
  name:"purehub-demo-state",
  version:2,
  migrate:(persisted)=>{
    const state=persisted as Partial<DemoStore>;
    return {
      role:state.role??initial.role,
      theme:state.theme??initial.theme,
      liked:state.liked??initial.liked,
      bookmarked:state.bookmarked??initial.bookmarked,
      followed:state.followed??initial.followed,
      subscriptions:state.subscriptions??initial.subscriptions,
      unlocked:state.unlocked??initial.unlocked,
      customPosts:(state.customPosts??[]).map(post=>({
        ...post,
        media:post.media??[],
        category:migrateCategory(String(post.category)),
        tags:post.tags.map(tag=>migrateCategory(tag)===tag?tag:(["数字艺术","摄影","动画","音乐","设计","游戏"].includes(tag)?migrateCategory(tag):tag))
      })),
      transactions:state.transactions??initial.transactions,
      balance:state.balance??initial.balance
    };
  },
  partialize:(s)=>({role:s.role,theme:s.theme,liked:s.liked,bookmarked:s.bookmarked,followed:s.followed,subscriptions:s.subscriptions,unlocked:s.unlocked,customPosts:s.customPosts,transactions:s.transactions,balance:s.balance})
}));

export const getAllPosts = (custom:Post[]) => [...custom,...seedPosts];
