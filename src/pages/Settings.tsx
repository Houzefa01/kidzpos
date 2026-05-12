import { useEffect, useState } from "react";
import { useAuth } from "@/store/auth";
import { useSettings } from "@/store/settings";
import { useData } from "@/store/data";
import { useExchange } from "@/store/exchange";
import { useBackend } from "@/store/backend";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Upload, RefreshCw, Save, Server, RotateCw, Wifi, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getApiUrl, setApiUrl } from "@/lib/apiConfig";

export default function Settings() {
  const { user } = useAuth();
  const { settings, update, reset } = useSettings();
  const { stores, addStore, updateStore, deleteStore, exportAll, importAll, resetAll } = useData();
  const { rate, fetchedAt, source, refresh, setManual } = useExchange();
  const { lanReachable, pendingCount } = useBackend();
  const [form, setForm] = useState(settings);
  const [apiUrl, setApiUrlLocal] = useState(getApiUrl());
  const [manualRate, setManualRate] = useState<string>(String(Math.round(rate)));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");
  const [newStoreLocation, setNewStoreLocation] = useState("");

  useEffect(() => setForm(settings), [settings]);

  if (user?.role !== "ADMIN") {
    return <div className="p-8 text-center text-sm text-muted-foreground">Accès réservé aux administrateurs.</div>;
  }

  const save = () => {
    if (form.taxRate < 0 || form.taxRate > 100) { toast.error("TVA invalide"); return; }
    if (form.maxDiscountPercent < 0 || form.maxDiscountPercent > 100) { toast.error("Plafond remise invalide"); return; }
    update(form);
    toast.success("Paramètres enregistrés");
  };

  const doExport = () => {
    const blob = new Blob([exportAll()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `kidzpos-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    toast.success("Sauvegarde téléchargée");
  };

  const doImport = (file: File) => {
    if (file.size > 5_000_000) { toast.error("Fichier trop volumineux (max 5 Mo)"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const res = importAll(String(reader.result));
      if (res.ok) toast.success("Import réussi"); else toast.error(`Fichier invalide : ${res.error ?? ""}`);
    };
    reader.readAsText(file);
  };

  const doReset = () => {
    if (!confirm("Réinitialiser TOUTES les données locales ? Cette action est irréversible.")) return;
    if (!confirm("Êtes-vous ABSOLUMENT SÛR ? Toutes les ventes, produits et clients locaux seront perdus.")) return;
    resetAll(); reset(); toast.success("Données réinitialisées");
  };

  const saveApiUrl = () => {
    const trimmed = apiUrl.trim();
    if (!trimmed) { toast.error("Adresse vide"); return; }
    try { new URL(trimmed); } catch { toast.error("URL invalide (ex: http://192.168.1.20:8080)"); return; }
    if (!/^https?:\/\//i.test(trimmed)) { toast.error("Doit commencer par http:// ou https://"); return; }
    setApiUrl(trimmed);
    toast.success("Adresse serveur enregistrée");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Paramètres</h1>
        <p className="text-sm text-muted-foreground">Configuration globale — admin uniquement</p>
      </div>

      <Card className="gradient-card border-border p-6">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold">
          <Server className="h-4 w-4" /> Serveur magasin
        </h2>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label>Adresse du serveur LAN/Internet</Label>
            <Input value={apiUrl} onChange={(e) => setApiUrlLocal(e.target.value)} placeholder="http://192.168.1.20:8080" />
            <p className="text-xs text-muted-foreground">
              Ex : <code>http://192.168.1.20:8080</code> en LAN, ou <code>https://kidzpos.monshop.com</code> sur Internet.
            </p>
          </div>
          <div className="flex items-end">
            <Button onClick={saveApiUrl}><Save className="mr-2 h-4 w-4" /> Appliquer</Button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className={`inline-block h-2 w-2 rounded-full ${lanReachable ? "bg-success" : "bg-destructive"}`} />
          {lanReachable ? "Connecté au serveur" : "Serveur injoignable — mode local"}
          {pendingCount > 0 && <span className="text-warning">· {pendingCount} action(s) en file</span>}
        </div>
      </Card>

      <Card className="gradient-card border-border p-6">
        <h2 className="mb-4 font-display text-lg font-bold">Devise & Taux de change</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Devise d'affichage</Label>
            <Select value={form.currency} onValueChange={(v: "AR" | "EUR") => setForm({ ...form, currency: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="AR">Ariary (Ar) — défaut</SelectItem>
                <SelectItem value="EUR">Euro (€)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Les prix sont stockés en Ariary. EUR n'est qu'une vue d'affichage convertie via le taux.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1"><Wifi className="h-3 w-3" /> Taux 1 € = ? Ar</Label>
            <div className="flex gap-2">
              <Input type="number" value={manualRate} onChange={(e) => setManualRate(e.target.value)} className="font-mono" />
              <Button variant="outline" onClick={() => { const r = +manualRate; if (r > 0) { setManual(r); toast.success("Taux manuel appliqué"); } }}>OK</Button>
              <Button
                variant="outline"
                disabled={isRefreshing}
                onClick={async () => {
                  setIsRefreshing(true);
                  try { await refresh(); } finally { setIsRefreshing(false); }
                }}
                title="Récupérer le taux du jour (Internet requis)"
              >
                <RotateCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Source : <strong>{source}</strong>
              {fetchedAt && ` · maj ${new Date(fetchedAt).toLocaleString("fr-FR")}`}
            </p>
          </div>
        </div>
      </Card>

      <Card className="gradient-card border-border p-6">
        <h2 className="mb-4 font-display text-lg font-bold">Magasin & Fiscalité</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Nom de l'enseigne</Label>
            <Input value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>TVA (%)</Label>
            <Input type="number" step="0.01" min={0} max={100} value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: +e.target.value || 0 })} />
          </div>
          <div className="space-y-1.5">
            <Label>Plafond remise employé (%)</Label>
            <Input type="number" min={0} max={100} value={form.maxDiscountPercent} onChange={(e) => setForm({ ...form, maxDiscountPercent: +e.target.value || 0 })} />
            <p className="text-xs text-muted-foreground">Les admins peuvent toujours dépasser ce plafond.</p>
          </div>
        </div>
      </Card>

      <Card className="gradient-card border-border p-6">
        <h2 className="mb-4 font-display text-lg font-bold">Programme de fidélité</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Points gagnés par Ariary dépensé</Label>
            <Input type="number" step="0.0001" min={0} value={form.pointsPerAr} onChange={(e) => setForm({ ...form, pointsPerAr: +e.target.value || 0 })} />
            <p className="text-xs text-muted-foreground">Ex : 0.0002 = 1 point pour 5 000 Ar.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Valeur d'un point (Ar)</Label>
            <Input type="number" step="1" min={0} value={form.arPerPoint} onChange={(e) => setForm({ ...form, arPerPoint: +e.target.value || 0 })} />
            <p className="text-xs text-muted-foreground">Ex : 100 = 1 point vaut 100 Ar de réduction.</p>
          </div>
        </div>
      </Card>

      <Card className="gradient-card border-border p-6">
        <h2 className="mb-4 font-display text-lg font-bold">Magasins</h2>

        <div className="space-y-3">
          {stores.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun magasin. Ajoutez-en un ci-dessous.</p>
          )}
          {stores.map((s) => (
            <div key={s.id} className="grid items-center gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                value={s.name}
                onChange={(e) => updateStore(s.id, { name: e.target.value })}
                placeholder="Nom"
              />
              <Input
                value={s.location}
                onChange={(e) => updateStore(s.id, { location: e.target.value })}
                placeholder="Adresse"
              />
              <Button
                variant="ghost"
                size="icon"
                title="Supprimer"
                onClick={() => {
                  if (!confirm(`Supprimer le magasin "${s.name}" ?`)) return;
                  const r = deleteStore(s.id);
                  if (r.ok) toast.success("Magasin supprimé");
                  else toast.error(r.error ?? "Suppression impossible");
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <Label className="mb-2 block">Ajouter un magasin</Label>
          <div className="grid items-center gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              value={newStoreName}
              onChange={(e) => setNewStoreName(e.target.value)}
              placeholder="Nom (ex: Magasin C)"
            />
            <Input
              value={newStoreLocation}
              onChange={(e) => setNewStoreLocation(e.target.value)}
              placeholder="Adresse / Ville"
            />
            <Button
              onClick={() => {
                const r = addStore({ name: newStoreName, location: newStoreLocation });
                if (r.ok) {
                  toast.success("Magasin ajouté");
                  setNewStoreName("");
                  setNewStoreLocation("");
                } else {
                  toast.error(r.error ?? "Ajout impossible");
                }
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Ajouter
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button onClick={save} className="gradient-primary text-primary-foreground">
          <Save className="mr-2 h-4 w-4" /> Enregistrer les paramètres
        </Button>
        <Button variant="outline" onClick={doExport}>
          <Download className="mr-2 h-4 w-4" /> Exporter JSON
        </Button>
        <label>
          <input type="file" accept="application/json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ""; }} />
          <Button variant="outline" asChild><span><Upload className="mr-2 h-4 w-4" /> Importer JSON</span></Button>
        </label>
        <Button variant="destructive" onClick={doReset}>
          <RefreshCw className="mr-2 h-4 w-4" /> Réinitialiser
        </Button>
      </div>
    </div>
  );
}
