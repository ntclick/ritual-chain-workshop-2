"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/Logo";

/** Shared chrome. The dapp adds its own network + wallet controls below this. */
export function Nav({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Home" },
    { href: "/markets", label: "Markets" },
  ];

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="brandmark nav-brand">
          <Logo />
          <span className="nav-brand-text">Ritual Predict</span>
        </Link>

        <div className="nav-links">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="nav-link"
              aria-current={pathname === link.href ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
          <a
            className="nav-link"
            href="https://docs.ritualfoundation.org"
            target="_blank"
            rel="noreferrer"
          >
            Docs ↗
          </a>
        </div>

        <div className="nav-actions">{children}</div>
      </div>
    </nav>
  );
}
