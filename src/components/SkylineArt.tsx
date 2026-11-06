/**
 * Decorative skyline for the sign-in screen: the same motif as the Market view on the dashboard.
 * Heights are fixed (not random) so server and client always render the same picture.
 */
const HEIGHTS = [34, 52, 41, 63, 48, 72, 58, 44, 81, 66, 49, 90, 70, 55, 62, 78, 46, 59, 84, 68, 51, 74, 43, 88, 61, 53, 76, 64, 47, 82, 57, 69, 45, 73, 60, 86, 50, 67, 56, 79];

export function SkylineArt() {
  const w = 10;
  const gap = 5;
  const width = HEIGHTS.length * (w + gap);
  return (
    <svg className="art-sky" viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="sky-fit" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#0073ff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#63fc66" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      {HEIGHTS.map((h, i) => (
        <rect key={i} x={i * (w + gap)} y={100 - h} width={w} height={h} rx="2" fill={i % 7 === 3 ? "#f5b942" : i % 5 === 0 ? "#2f343b" : "url(#sky-fit)"} opacity={i % 5 === 0 || i % 7 === 3 ? 0.8 : 1} />
      ))}
    </svg>
  );
}
