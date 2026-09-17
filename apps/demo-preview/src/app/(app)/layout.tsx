import { AppShell } from "@/components/app-shell";
import { ScopeProvider } from "@/components/scope-provider";

export default function AuthenticatedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ScopeProvider><AppShell>{children}</AppShell></ScopeProvider>;
}
