// Helper centralisé pour afficher les montants dans la devise active.
// Source de vérité : useSettings().settings.currency ("AR" | "EUR")
// Conversion : 1 EUR = N AR (taux récupéré du backend ou stocké en local).

import { useSettings } from "@/store/settings";
import { useExchange } from "@/store/exchange";

const fmtAr = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const fmtEur = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Tous les montants stockés en interne sont en EUR (cohérent avec le backend).
 *  Cette fonction retourne la chaîne formatée dans la devise courante. */
export function formatMoney(amountEur: number): string {
  const { currency } = useSettings.getState().settings;
  if (currency === "AR") {
    const rate = useExchange.getState().rate;
    const ar = amountEur * rate;
    return `${fmtAr.format(Math.round(ar))} Ar`;
  }
  return `${fmtEur.format(amountEur)} €`;
}

/** Symbole court ("Ar" / "€") pour les libellés. */
export function currencySymbol(): string {
  return useSettings.getState().settings.currency === "AR" ? "Ar" : "€";
}

/**
 * Hook : se ré-évalue automatiquement quand la devise ou le taux changent.
 * M6 : pas de useState/useEffect — les sélecteurs Zustand suffisent à déclencher
 * le re-render du composant appelant. La closure capturée utilise les valeurs courantes.
 */
export function useFormatMoney() {
  const currency = useSettings((s) => s.settings.currency);
  const rate = useExchange((s) => s.rate);
  return (amountEur: number) => {
    if (currency === "AR") return `${fmtAr.format(Math.round(amountEur * rate))} Ar`;
    return `${fmtEur.format(amountEur)} €`;
  };
}
