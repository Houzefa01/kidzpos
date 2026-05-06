import { create } from "zustand";
import { persist } from "zustand/middleware";
import { pushMutation } from "@/store/backend";

export type Currency = "AR" | "EUR";

export interface Settings {
  taxRate: number; // %
  maxDiscountPercent: number;
  pointsPerEuro: number;
  euroPerPoint: number;
  shopName: string;
  currency: Currency; // devise d'affichage par défaut Ar
}

interface SettingsState {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const DEFAULTS: Settings = {
  taxRate: 20,
  maxDiscountPercent: 10,
  pointsPerEuro: 1,
  euroPerPoint: 0.05,
  shopName: "KidzPOS",
  currency: "AR",
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULTS,
      update: (patch) => {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
        const cur = useSettings.getState().settings;
        pushMutation("/api/settings", "PUT", cur, "settings");
      },
      reset: () => {
        set({ settings: DEFAULTS });
        pushMutation("/api/settings", "PUT", DEFAULTS, "settings");
      },
    }),
    {
      name: "kidzpos-settings",
      version: 2,
      migrate: (persisted: unknown) => {
        const state = persisted as Record<string, Record<string, string>>;
        if (state?.settings && !state.settings.currency) {
          state.settings.currency = "AR";
        }
        return state;
      },
    }
  )
);
