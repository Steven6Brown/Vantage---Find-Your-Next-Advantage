"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="wrap">
      <h1>Something went wrong</h1>
      <p>The dashboard could not load. No details are shown here for safety.</p>
      <button className="btn primary" onClick={reset}>Try again</button>
    </main>
  );
}
