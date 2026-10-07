import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
            <Link href="/">
              <h1 className="mb-8 text-xl font-bold">ANGEL AGENT</h1>
            </Link>

            <nav className="flex flex-col gap-4 text-sm">
              <Link href="/">Dashboard</Link>
              <Link href="/products">Products</Link>
              <span>Sourcing</span>
              <span>VOC</span>
              <span>Ads</span>
              <Link href="/content/blog">Content</Link>
              <Link href="/content/kin">KIN</Link>
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
