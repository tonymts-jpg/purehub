import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "PureHub — 让创作持续发生",
  description: "为创作者与真正关心作品的人打造的会员社区。"
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="zh-CN" suppressHydrationWarning><body><AppShell>{children}</AppShell></body></html>;
}
