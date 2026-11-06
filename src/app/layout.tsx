import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { APP_NAME } from "@/lib/brand";
import { getSession } from "@/lib/session";
import "./globals.css";

// DM Sans from the portfolio, with its optical-size axis so large titles tighten up automatically.
const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap", axes: ["opsz"] });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: "Finds and ranks entry-level cybersecurity listings for human review. It does not auto-apply.",
  robots: { index: false, follow: false },
};

// Runs before the page paints: use the saved choice, otherwise follow the device.
const THEME_SCRIPT = "(function(){try{var m=localStorage.getItem('vantage-theme');var l=window.matchMedia('(prefers-color-scheme: light)').matches;document.documentElement.dataset.theme=(m==='light'||m==='dark')?m:(l?'light':'dark');if(localStorage.getItem('vantage-density')==='compact')document.documentElement.dataset.density='compact';}catch(e){}})();";

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#000000" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="dark light" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        {session ? <AppShell email={session.user.email}>{children}</AppShell> : children}
      </body>
    </html>
  );
}
