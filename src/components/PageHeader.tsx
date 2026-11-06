export function PageHeader({ title, children, actions }: { title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="pagehead">
      <div>
        <h1>{title}</h1>
        {children && <p className="lede">{children}</p>}
      </div>
      {actions}
    </header>
  );
}
