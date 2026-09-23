import Link from "next/link";

type Section = "local" | "route";

export default function SiteHeader({ section }: { section: Section }) {
  return <header className="site-header">
    <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">◉</span><span>LLUVIA</span></Link>
    <nav className="site-nav" aria-label="Navegación principal">
      <Link href="/" aria-current={section === "local" ? "page" : undefined}>Pronóstico local</Link>
      <Link href="/routes" aria-current={section === "route" ? "page" : undefined}>Ruta</Link>
    </nav>
  </header>;
}
