"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** A Notes sidebar entry, marked current on its page. */
export function NotesSidebarLink({ href, exact = false, children }: { href: string; exact?: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const current = exact ? pathname === href : pathname?.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${current ? "bg-zk-tint text-zk-accent" : "text-zk-text2 hover:bg-zk-chip hover:text-zk-text"}`}
    >
      {children}
    </Link>
  );
}
