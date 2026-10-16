import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

/* eslint-disable @next/next/no-html-link-for-pages -- Sidebar links intentionally use full document navigation. */

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Angel Agent",
  description: "Internal ecommerce agent",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body suppressHydrationWarning>
        <div className="flex min-h-screen bg-zinc-100 text-zinc-900">
          <aside className="w-64 border-r border-zinc-200 bg-white p-6">
            <a href="/">
              <h1 className="mb-8 text-xl font-bold">ANGEL AGENT</h1>
            </a>

            <nav className="flex flex-col gap-4 text-sm">
              <a href="/">Dashboard</a>
              <a href="/products">Products</a>
              <span>Sourcing</span>
              <a href="/voc">VOC</a>
              <a href="/ads/references">Ads</a>
              <a href="/content/blog">Content</a>
              <a href="/content/kin">지식인</a>
              <span>Sales</span>
              <span>Settings</span>
            </nav>
          </aside>

          <div className="flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
