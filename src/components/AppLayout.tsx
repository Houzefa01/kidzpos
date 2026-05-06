import { useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { OfflineBanner } from "./OfflineBanner";
import { ThemeToggle } from "./ThemeToggle";
import { Outlet, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { tokenStore } from "@/lib/apiClient";
import { toast } from "sonner";

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Écoute la fin de session (token 401) — redirection via React Router, pas hard reload
  useEffect(() => {
    const handler = () => {
      toast.error("Session expirée — veuillez vous reconnecter");
      logout();
      navigate("/login", { replace: true });
    };
    window.addEventListener("auth:session-expired", handler);
    return () => window.removeEventListener("auth:session-expired", handler);
  }, [logout, navigate]);

  // Vérification initiale : si le token a expiré entre deux sessions
  useEffect(() => {
    if (user && !tokenStore.get()) {
      logout();
      navigate("/login", { replace: true });
    }
  }, [user, logout, navigate]);

  if (!user) return <Navigate to="/login" replace />;

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <OfflineBanner />
          <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl">
            <SidebarTrigger />
            <div className="flex-1" />
            <ThemeToggle />
            <div className="text-xs text-muted-foreground">
              Connecté: <span className="font-medium text-foreground">{user.name}</span>
            </div>
          </header>
          <main className="flex-1 animate-fade-in p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

export function RequireRole({ role, children }: { role: "ADMIN" | "EMPLOYEE"; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}
