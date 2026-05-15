import { useEffect, useState } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useBackend } from "@/store/backend";
import { useFailedReplays } from "@/store/failedReplays";
import { WifiOff, CloudOff, CloudUpload, AlertCircle } from "lucide-react";
import { FailedReplaysButton } from "@/components/FailedReplaysButton";

export function OfflineBanner() {
  const online = useOnlineStatus();
  const { lanReachable, pendingCount } = useBackend();
  const failedCount = useFailedReplays((s) => s.failures.length);

  // Ne pas afficher "injoignable" immédiatement — attendre 3s de non-connexion soutenue
  // pour éviter le flash pendant le chargement initial (le premier ping prend ~100ms).
  const [showInjoignable, setShowInjoignable] = useState(false);
  useEffect(() => {
    if (lanReachable) { setShowInjoignable(false); return; }
    const t = setTimeout(() => setShowInjoignable(true), 3000);
    return () => clearTimeout(t);
  }, [lanReachable]);

  // Tout est sain ET aucun échec → bannière masquée (comportement historique).
  if (online && lanReachable && pendingCount === 0 && failedCount === 0) return null;

  // Banner non-sticky en lui-même : AppLayout l'enveloppe avec le header dans
  // un parent sticky commun, sinon banner + header sticky top-0 se chevaucheraient.
  const baseCls = "no-print flex flex-wrap items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium";

  if (!online) {
    return (
      <div className={`${baseCls} bg-warning/15 text-foreground`}>
        <WifiOff className="h-3.5 w-3.5" />
        <span>
          Mode hors-ligne — vos actions sont enregistrées localement et seront synchronisées
          {pendingCount > 0 && ` (${pendingCount} en attente)`}
        </span>
        <FailedReplaysButton count={failedCount} />
      </div>
    );
  }

  if (!lanReachable && showInjoignable) {
    return (
      <div className={`${baseCls} bg-warning/15 text-foreground`}>
        <CloudOff className="h-3.5 w-3.5" />
        <span>
          Serveur magasin injoignable — données sauvegardées localement
          {pendingCount > 0 && ` · ${pendingCount} action(s) en file d'attente`}
        </span>
        <FailedReplaysButton count={failedCount} />
      </div>
    );
  }

  if (lanReachable && pendingCount > 0) {
    return (
      <div className={`${baseCls} bg-primary/15 text-primary`}>
        <CloudUpload className="h-3.5 w-3.5 animate-pulse" />
        <span>Synchronisation en cours… {pendingCount} action(s) restantes</span>
        <FailedReplaysButton count={failedCount} />
      </div>
    );
  }

  // Tout sain MAIS des échecs persistants → bannière dédiée discrète.
  if (failedCount > 0) {
    return (
      <div className={`${baseCls} bg-destructive/10 text-foreground`}>
        <AlertCircle className="h-3.5 w-3.5 text-destructive" />
        <span>
          {failedCount} action{failedCount > 1 ? "s" : ""} non synchronisée
          {failedCount > 1 ? "s" : ""} — rejetée
          {failedCount > 1 ? "s" : ""} par le serveur
        </span>
        <FailedReplaysButton count={failedCount} />
      </div>
    );
  }

  return null;
}
