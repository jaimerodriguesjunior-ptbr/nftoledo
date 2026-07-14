"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  FilePlus,
  FileText,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Menu,
  Users,
  X,
} from "lucide-react";
import { logout } from "@/actions/auth";

const navItems = [
  { href: "/dashboard", label: "Inicio", icon: LayoutDashboard },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/emitir", label: "Emitir Nota", icon: FilePlus },
  { href: "/lote", label: "Emissao em Lote", icon: ListOrdered },
  { href: "/notas", label: "Notas Emitidas", icon: FileText },
  { href: "/empresa", label: "Minha Empresa", icon: Building2 },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const navContent = (
    <>
      <div className="px-6 py-5 border-b border-gray-100">
        <span className="text-xl font-bold text-blue-600">NF Facil</span>
        <p className="text-xs text-gray-400 mt-0.5">Emissor de NFS-e</p>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            pathname === href ||
            (href !== "/dashboard" && pathname.startsWith(href));

          return (
            <Link
              key={href}
              href={href}
              onClick={() => setIsOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <Icon size={17} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-gray-100">
        <form action={logout}>
          <button
            type="submit"
            className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-50 rounded-lg w-full transition-colors"
          >
            <LogOut size={17} />
            Sair
          </button>
        </form>
      </div>
    </>
  );

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 md:hidden">
        <div>
          <p className="text-base font-bold text-blue-600">NF Facil</p>
          <p className="text-[11px] text-gray-400">Emissor de NFS-e</p>
        </div>
        <button
          type="button"
          aria-label={isOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-700"
        >
          {isOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      {isOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-40 bg-gray-900/30 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-gray-200 bg-white transition-transform duration-200 md:static md:min-h-screen md:w-60 md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {navContent}
      </aside>
    </>
  );
}
