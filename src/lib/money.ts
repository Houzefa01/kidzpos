// Helper centralisé pour afficher les montants dans la devise active.
// Source de vérité : useSettings().settings.currency ("AR" | "EUR")
// Conversion : 1 EUR = N AR (taux récupéré du backend ou stocké en local).

import { useSettings } from "@/store/settings";
import { useExchange } from "@/store/exchange";

const fmtAr = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const fmtEur = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Helper pur — formate un montant EUR dans la devise demandée avec le taux fourni.
 * Utilisable hors composant React (PDF, exports, tests).
 */
export function formatMoneyAs(amountEur: number, currency: "AR" | "EUR", rate: number): string {
  if (currency === "AR") return `${fmtAr.format(Math.round(amountEur * rate))} Ar`;
  return `${fmtEur.format(amountEur)} €`;
}

/**
 * Saisie utilisateur (dans la devise affichée) → montant EUR à stocker.
 * Inverse de formatMoneyAs. Si rate <= 0, retourne 0 pour éviter NaN/Infinity.
 */
export function parseMoneyToEur(amount: number, currency: "AR" | "EUR", rate: number): number {
  if (!Number.isFinite(amount)) return 0;
  if (currency === "AR") return rate > 0 ? amount / rate : 0;
  return amount;
}

/** Tous les montants stockés en interne sont en EUR (cohérent avec le backend).
 *  Cette fonction retourne la chaîne formatée dans la devise courante. */
export function formatMoney(amountEur: number): string {
  const { currency } = useSettings.getState().settings;
  const rate = useExchange.getState().rate;
  return formatMoneyAs(amountEur, currency, rate);
}

/** Symbole court ("Ar" / "€") pour les libellés. Accepte un override (ex: devise figée d'une vente). */
export function currencySymbol(override?: "AR" | "EUR"): string {
  const cur = override ?? useSettings.getState().settings.currency;
  return cur === "AR" ? "Ar" : "€";
}

/**
 * Hook : se ré-évalue automatiquement quand la devise ou le taux changent.
 * M6 : pas de useState/useEffect — les sélecteurs Zustand suffisent à déclencher
 * le re-render du composant appelant. La closure capturée utilise les valeurs courantes.
 */
export function useFormatMoney() {
  const currency = useSettings((s) => s.settings.currency);
  const rate = useExchange((s) => s.rate);
  // `override` permet d'afficher un montant dans la devise figée d'une vente passée
  // (cf. Sale.currency), indépendamment du réglage global courant.
  return (amountEur: number, override?: "AR" | "EUR") =>
    formatMoneyAs(amountEur, override ?? currency, rate);
}
