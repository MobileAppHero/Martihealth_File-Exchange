import { Link, useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMe } from "@/hooks/use-me";
import {
  FolderLock,
  Folder,
  Users,
  Building2,
  ScrollText,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: me } = useMe();

  const user = me?.user ?? null;

  const logout = useMutation({
    mutationFn: () => api.post("/auth/logout"),
  });

  const navItems = [
    { label: user?.role === "admin" ? "All files" : "My files", href: "/files", icon: Folder },
    ...(user?.role === "admin"
      ? [
          { label: "Clients", href: "/admin/clients", icon: Building2 },
          { label: "Users", href: "/admin/users", icon: Users },
          { label: "Audit log", href: "/admin/audit", icon: ScrollText },
        ]
      : []),
  ];

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSettled: () => {
        queryClient.clear();
        setLocation("/sign-in");
      },
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b bg-card">
        <Link href="/files" className="flex items-center gap-2 font-display font-semibold text-lg text-primary">
          <FolderLock className="w-5 h-5" />
          Marti FX
        </Link>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="Sign out">
            <LogOut className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </div>
      </header>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-card border-r flex flex-col transition-transform duration-200 ease-in-out
        md:relative md:translate-x-0
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="hidden md:flex p-6 items-center gap-3 text-primary">
          <FolderLock className="w-6 h-6" />
          <span className="font-display font-bold text-xl tracking-tight">Marti FX</span>
        </div>

        <nav className="flex-1 px-4 py-6 md:py-2 space-y-1">
          {navItems.map((item) => {
            const isActive =
              location === item.href ||
              (item.href === "/files" && location.startsWith("/files")) ||
              (item.href === "/admin/clients" && location.startsWith("/admin/clients"));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors
                  ${isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"}
                `}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t hidden md:block">
          {user && (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="Sign out">
                <LogOut className="w-4 h-4 text-muted-foreground" />
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">
          {children}
        </div>
      </main>

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
    </div>
  );
}
