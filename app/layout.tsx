import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "卵巢肿瘤影像数据平台",
  description: "面向多中心超声科的卵巢肿瘤影像收集、主体隔离与质控管理平台。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
