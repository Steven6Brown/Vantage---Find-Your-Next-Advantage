"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/brand";
import { DensityToggle } from "./DensityToggle";
import { Logo } from "./Logo";
import { SignOutButton } from "./SecurityPanels";
import { ThemeToggle } from "./ThemeToggle";

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={d} />
  </svg>
);

const NAV = [
  { href: "/", label: "Openings", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/import", label: "Import", icon: "M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" },
  { href: "/settings", label: "Settings", icon: "M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6" },
  { href: "/security", label: "Security", icon: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" },
];

/** Signed-in frame: navigation rail on desktop, a top bar on small screens. */
export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const path = usePathname();
  const current = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="app">
      <aside className="rail" aria-label="Vantage">
        <Link href="/" className="lockup">
          <Logo size={32} />
          <span><b>{APP_NAME}</b><small>by Steven Brown</small></span>
        </Link>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="navlink" aria-current={current(n.href) ? "page" : undefined}>
              <Icon d={n.icon} />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="rail-foot">
          <span className="who" title={email}>{email}</span>
          <div className="foot-actions">
            <ThemeToggle />
            <DensityToggle />
            <SignOutButton />
          </div>
        </div>
      </aside>
      <div className="stage">{children}</div>
    </div>
  );
}
