import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PureHub — 让创作持续发生",
  description: "为博主与真正关心作品的人打造的会员社区。"
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="zh-CN" suppressHydrationWarning><body>{children}</body></html>;
}
