import { APP_BLURB, APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { Logo } from "./Logo";
import { SkylineArt } from "./SkylineArt";
import { ThemeToggle } from "./ThemeToggle";

/** Sign-in layout: brand panel with the skyline on the left, the form on the right. */
export function AuthFrame({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-art">
        <div className="lockup static">
          <Logo size={34} />
          <span><b>{APP_NAME}</b><small>by Steven Brown</small></span>
        </div>
        <div className="art-copy">
          <h2>{APP_TAGLINE}</h2>
          <p>{APP_BLURB}</p>
        </div>
        <SkylineArt />
      </aside>
      <main id="main" className="auth-main">
        <div className="auth-tools"><ThemeToggle /></div>
        <div className="login">
          <div className="lockup static mobile-only">
            <Logo size={30} />
            <span><b>{APP_NAME}</b></span>
          </div>
          <h1>{title}</h1>
          {sub && <p className="lede" style={{ margin: 0 }}>{sub}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
