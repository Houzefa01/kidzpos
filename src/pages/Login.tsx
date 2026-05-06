import { useEffect, useState } from "react";
import { preloadRoute } from "@/lib/preload";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Sparkles, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const demoAccounts = import.meta.env.DEV
  ? [
      { label: "Admin", email: "admin@kidzpos.com", password: "admin123" },
      { label: "Caissier A", email: "sarah@kidzpos.com", password: "sarah123" },
      { label: "Caissier B", email: "karim@kidzpos.com", password: "karim123" },
    ]
  : [];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Précharge le Dashboard pendant que l'utilisateur tape
  useEffect(() => { preloadRoute("/"); preloadRoute("/pos"); }, []);

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await login(email.trim().toLowerCase(), password);
    setLoading(false);
    if (res.ok && res.user) {
      toast.success(`Bienvenue ${res.user.name}`);
      navigate("/");
    } else {
      toast.error(res.error ?? "Identifiants invalides");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="grid w-full max-w-5xl gap-8 lg:grid-cols-2">
        {/* Left: brand */}
        <div className="hidden flex-col justify-between lg:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-primary shadow-glow">
              <Sparkles className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold">KidzPOS</h1>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Caisse & Stock</p>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="font-display text-4xl font-bold leading-tight">
              Pilotez vos <span className="text-gradient">2 magasins</span> en temps réel.
            </h2>
            <p className="text-muted-foreground">
              Gestion de stock, ventes en caisse et statistiques unifiées pour votre boutique
              d'articles enfants.
            </p>
          </div>

          {import.meta.env.DEV && demoAccounts.length > 0 && (
            <div className="space-y-2 rounded-xl border border-border bg-card/50 p-4 backdrop-blur">
              <p className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-success" /> Comptes de démonstration
              </p>
              <div className="space-y-1 font-mono text-xs text-muted-foreground">
                {demoAccounts.map((a) => (
                  <button
                    key={a.email}
                    onClick={() => {
                      setEmail(a.email);
                      setPassword(a.password);
                    }}
                    className="block w-full rounded px-2 py-1 text-left transition hover:bg-secondary hover:text-foreground"
                  >
                    <span className="text-primary">{a.label}</span> — {a.email} / {a.password}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: form */}
        <Card className="gradient-card border-border p-8 shadow-elevated">
          <div className="mb-6 lg:hidden">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg gradient-primary">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <h1 className="font-display text-2xl font-bold">KidzPOS</h1>
          </div>

          <h2 className="font-display text-2xl font-bold">Connexion</h2>
          <p className="mb-6 text-sm text-muted-foreground">Accédez à votre espace de gestion.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@kidzpos.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <Button type="submit" className="w-full gradient-primary text-primary-foreground hover:opacity-90" disabled={loading}>
              {loading ? "Connexion..." : "Se connecter"}
            </Button>
          </form>

          {import.meta.env.DEV && (
            <p className="mt-6 text-center text-xs text-muted-foreground lg:hidden">
              Démo: admin@kidzpos.com / admin123
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
