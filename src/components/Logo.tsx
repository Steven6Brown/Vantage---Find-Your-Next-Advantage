/** Steven Brown "SB" mark (public/logo.png, 256 px wide copy of the portfolio logo). Decorative: the link next to it carries the name. */
export function Logo({ size = 32 }: { size?: number }) {
  // Original aspect ratio is 4167:3821.
  const width = Math.round((size * 4167) / 3821);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.png" alt="" width={width} height={size} style={{ display: "block" }} />;
}
