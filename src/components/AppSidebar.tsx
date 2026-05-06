import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Receipt,
  Users,
  UsersRound,
  Settings as SettingsIcon,
  Store as StoreIcon,
  LogOut,
  Sparkles,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useNavigate } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/store/auth";
import { useData } from "@/store/data";
import { Button } from "@/components/ui/button";
import { preloadRoute } from "@/lib/preload";
import { useEffect } from "react";

const adminItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Caisse (POS)", url: "/pos", icon: ShoppingCart },
  { title: "Stock & Produits", url: "/stock", icon: Package },
  { title: "Ventes", url: "/sales", icon: Receipt },
  { title: "Clients", url: "/customers", icon: UsersRound },
  { title: "Utilisateurs", url: "/users", icon: Users },
  { title: "Paramètres", url: "/settings", icon: SettingsIcon },
];

const employeeItems = [
  { title: "Caisse (POS)", url: "/pos", icon: ShoppingCart },
  { title: "Mon Stock", url: "/stock", icon: Package },
  { title: "Mes Ventes", url: "/sales", icon: Receipt },
  { title: "Clients", url: "/customers", icon: UsersRound },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { user, logout } = useAuth();
  const { stores } = useData();
  const navigate = useNavigate();

  // Précharge toutes les pages accessibles, en idle, après l'auth.
  useEffect(() => {
    if (!user) return;
    type RIC = (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
    const idle = (cb: () => void) =>
      "requestIdleCallback" in window
        ? (window as Window & { requestIdleCallback: RIC }).requestIdleCallback(cb, { timeout: 2000 })
        : setTimeout(cb, 800);
    const allowed = user.role === "ADMIN" ? adminItems : employeeItems;
    idle(() => allowed.forEach((i) => preloadRoute(i.url)));
  }, [user]);

  if (!user) return null;
  const items = user.role === "ADMIN" ? adminItems : employeeItems;
  const currentStore = stores.find((s) => s.id === user.storeId);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-primary shadow-glow">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold leading-none">KidzPOS</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Multi-magasin</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{user.role === "ADMIN" ? "Administration" : "Espace Caissier"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const showBadge = item.url === "/stock";
                const lowCount = showBadge
                  ? (user.role === "ADMIN" ? useData.getState().products : useData.getState().products.filter((p) => p.storeId === user.storeId)).filter((p) => p.stock <= 3).length
                  : 0;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end={item.url === "/"}
                        onMouseEnter={() => preloadRoute(item.url)}
                        onFocus={() => preloadRoute(item.url)}
                        className="flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-sidebar-accent"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-semibold border-l-2 border-primary"
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span className="flex-1">{item.title}</span>}
                        {!collapsed && showBadge && lowCount > 0 && (
                          <span className="rounded-full bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold text-warning">{lowCount}</span>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {!collapsed && currentStore && (
          <SidebarGroup>
            <SidebarGroupLabel>Magasin</SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="mx-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <StoreIcon className="h-4 w-4 text-primary" />
                  {currentStore.name}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{currentStore.location}</p>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        {!collapsed ? (
          <div className="space-y-2">
            <div className="px-2">
              <p className="text-sm font-medium leading-tight">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.role === "ADMIN" ? "Administrateur" : "Caissier"}</p>
            </div>
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" /> Déconnexion
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="icon" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
