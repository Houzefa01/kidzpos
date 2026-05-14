import { useEffect, useState } from "react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useBackend } from "@/store/backend";
import { WifiOff, CloudOff, CloudUpload } from "lucide-react";

export function OfflineBanner() {
  const online = useOnlineStatus();
  const { lanReachable, pendingCount } = useBackend();

  // Ne pas afficher "injoignable" immédiatement — attendre 3s de non-connexion soutenue
  // pour éviter le flash pendant le chargement initial (le premier ping prend ~100ms).
  const [showInjoignable, setShowInjoignable] = useState(false);
  useEffect(() => {
    if (lanReachable) { setShowInjoignable(false); return; }
    const t = setTimeout(() => setShowInjoignable(true), 3000);
    return () => clearTimeout(t);
  }, [lanReachable]);

  if (online && lanReachable && pendingCount === 0) return null;

  // Banner non-sticky en lui-même : AppLayout l'enveloppe avec le header dans
  // un parent sticky commun, sinon banner + header sticky top-0 se chevaucheraient.
  const baseCls = "no-print flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium";

  if (!online) {
    return (
      <div className={`${baseCls} bg-warning/15 text-foreground`}>
        <WifiOff className="h-3.5 w-3.5" />
        Mode hors-ligne — vos actions sont enregistrées localement et seront synchronisées
        {pendingCount > 0 && ` (${pendingCount} en attente)`}
      </div>
    );
  }

  if (!lanReachable && showInjoignable) {
    return (
      <div className={`${baseCls} bg-warning/15 text-foreground`}>
        <CloudOff className="h-3.5 w-3.5" />
        Serveur magasin injoignable — données sauvegardées localement
        {pendingCount > 0 && ` · ${pendingCount} action(s) en file d'attente`}
      </div>
    );
  }

  if (lanReachable && pendingCount > 0) {
    return (
      <div className={`${baseCls} bg-primary/15 text-primary`}>
        <CloudUpload className="h-3.5 w-3.5 animate-pulse" />
        Synchronisation en cours… {pendingCount} action(s) restantes
      </div>
    );
  }

  return null;
}
