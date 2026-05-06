import { create } from "zustand";
import { persist } from "zustand/middleware";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { broadcastSync } from "@/lib/sync";
import { api, tokenStore } from "@/lib/apiClient";
import { hydrateFromBackend } from "@/lib/syncBackend";
import { useBackend, pushMutation } from "@/store/backend";

export type Role = "ADMIN" | "EMPLOYEE";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  storeId: string | null;
  active: boolean;
}

interface AuthState {
  user: User | null;
  users: User[];
  /** email -> hashed password (salt$hash) */
  passwords: Record<string, string>;
  /** email -> { count, lockedUntil } */
  attempts: Record<string, { count: number; lockedUntil: number }>;
  login: (email: string, password: string) => Promise<{ ok: boolean; user?: User; error?: string }>;
  logout: () => void;
  addUser: (u: Omit<User, "id">, password: string) => Promise<{ ok: boolean; error?: string }>;
  toggleUser: (id: string) => { ok: boolean; error?: string };
  updateUser: (id: string, patch: Partial<Omit<User, "id">>) => { ok: boolean; error?: string };
  deleteUser: (id: string) => { ok: boolean; error?: string };
  setPassword: (email: string, password: string) => Promise<void>;
}

const seedUsers: User[] = import.meta.env.DEV
  ? [
      { id: "u1", name: "Admin Principal", email: "admin@kidzpos.com", role: "ADMIN", storeId: null, active: true },
      { id: "u2", name: "Sarah (Magasin A)", email: "sarah@kidzpos.com", role: "EMPLOYEE", storeId: "s1", active: true },
      { id: "u3", name: "Karim (Magasin B)", email: "karim@kidzpos.com", role: "EMPLOYEE", storeId: "s2", active: true },
    ]
  : [];

const activeAdmins = (users: User[]) => users.filter((u) => u.role === "ADMIN" && u.active).length;

const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000;

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      users: seedUsers,
      passwords: {},
      attempts: {},
      login: async (rawEmail, password) => {
        const email = rawEmail.trim().toLowerCase();
        const now = Date.now();
        const att = get().attempts[email];
        if (att && att.lockedUntil > now) {
          const sec = Math.ceil((att.lockedUntil - now) / 1000);
          return { ok: false, error: `Compte verrouillé (${sec}s)` };
        }

        // 1) Tentative backend (LAN) — si réussi, c'est la source de vérité
        try {
          const res = await api<{ token: string; user: User }>("/api/auth/login", {
            method: "POST", body: { email, password }, noAuth: true, timeoutMs: 10000,
          });
          tokenStore.set(res.token);
          // Mémoriser localement pour la reconnexion offline (best-effort : non dispo sur HTTP)
          const hashed = await hashPassword(password);
          set((s) => {
            const a = { ...s.attempts }; delete a[email];
            const exists = s.users.some((x) => x.id === res.user.id);
            const passwords = hashed
              ? { ...s.passwords, [email]: hashed }
              : s.passwords;
            return {
              user: res.user,
              attempts: a,
              users: exists
                ? s.users.map((x) => (x.id === res.user.id ? { ...x, ...res.user } : x))
                : [...s.users, res.user],
              passwords,
            };
          });
          useBackend.setState({ lanReachable: true });
          // Hydrate les autres stores en arrière-plan (non bloquant)
          hydrateFromBackend().catch(() => {});
          broadcastSync("kidzpos-auth");
          return { ok: true, user: res.user };
        } catch (e: unknown) {
          // 401 du backend = vrai mauvais mot de passe → on s'arrête là
          if ((e as { status?: number })?.status === 401) {
            const next = (att?.count ?? 0) + 1;
            const lockedUntil = next >= MAX_ATTEMPTS ? now + LOCK_DURATION_MS : 0;
            set((s) => ({ attempts: { ...s.attempts, [email]: { count: next, lockedUntil } } }));
            return { ok: false, error: lockedUntil ? "Trop d'essais — compte verrouillé 5 min" : "Identifiants invalides" };
          }
          // Réseau / timeout / 5xx → on bascule en mode offline
          useBackend.setState({ lanReachable: false });
        }

        // 2) Fallback offline : auth locale (compte déjà connu)
        const u = get().users.find((x) => x.email === email && x.active);
        if (!u) return { ok: false, error: "Hors-ligne et compte inconnu localement" };
        const stored = get().passwords[email];
        if (!stored) return { ok: false, error: "Hors-ligne : connectez-vous une fois en ligne d'abord" };
        const ok = await verifyPassword(password, stored);
        if (!ok) {
          const next = (att?.count ?? 0) + 1;
          const lockedUntil = next >= MAX_ATTEMPTS ? now + LOCK_DURATION_MS : 0;
          set((s) => ({ attempts: { ...s.attempts, [email]: { count: next, lockedUntil } } }));
          return { ok: false, error: lockedUntil ? "Trop d'essais — compte verrouillé 5 min" : "Identifiants invalides" };
        }
        set((s) => {
          const a = { ...s.attempts }; delete a[email];
          return { user: u, attempts: a };
        });
        broadcastSync("kidzpos-auth");
        return { ok: true, user: u };
      },
      logout: () => { tokenStore.set(null); set({ user: null }); broadcastSync("kidzpos-auth"); },
      addUser: async (u, password) => {
        const email = u.email.toLowerCase();
        if (get().users.some((x) => x.email.toLowerCase() === email)) {
          return { ok: false, error: "Email déjà utilisé" };
        }
        if (!password || password.length < 4) return { ok: false, error: "Mot de passe trop court (4 min)" };
        const hashed = await hashPassword(password);
        const newUser = { ...u, email, id: `u${Date.now()}` };
        set((s) => ({
          users: [...s.users, newUser],
          passwords: { ...s.passwords, [email]: hashed },
        }));
        broadcastSync("kidzpos-auth");
        pushMutation("/api/users", "POST", {
          name: u.name, email, password, role: u.role, storeId: u.storeId, active: u.active,
        }, `user:${newUser.id}`);
        return { ok: true };
      },
      toggleUser: (id) => {
        const target = get().users.find((x) => x.id === id);
        if (!target) return { ok: false, error: "Utilisateur introuvable" };
        if (target.role === "ADMIN" && target.active && activeAdmins(get().users) <= 1) {
          return { ok: false, error: "Impossible de désactiver le dernier admin actif" };
        }
        set((s) => ({ users: s.users.map((x) => (x.id === id ? { ...x, active: !x.active } : x)) }));
        broadcastSync("kidzpos-auth");
        pushMutation(`/api/users/${id}`, "PUT", { active: !target.active }, `user:${id}`);
        return { ok: true };
      },
      updateUser: (id, patch) => {
        const target = get().users.find((x) => x.id === id);
        if (!target) return { ok: false, error: "Utilisateur introuvable" };
        const newEmail = (patch.email ?? target.email).toLowerCase();
        if (newEmail !== target.email && get().users.some((x) => x.id !== id && x.email.toLowerCase() === newEmail)) {
          return { ok: false, error: "Email déjà utilisé" };
        }
        // Si on rétrograde le dernier admin
        if (target.role === "ADMIN" && patch.role && patch.role !== "ADMIN" && activeAdmins(get().users) <= 1) {
          return { ok: false, error: "Impossible de rétrograder le dernier admin" };
        }
        set((s) => ({
          users: s.users.map((x) => (x.id === id ? { ...x, ...patch, email: newEmail } : x)),
          // Si email change, déplacer le password
          passwords: newEmail !== target.email && s.passwords[target.email]
            ? { ...Object.fromEntries(Object.entries(s.passwords).filter(([k]) => k !== target.email)), [newEmail]: s.passwords[target.email] }
            : s.passwords,
        }));
        broadcastSync("kidzpos-auth");
        pushMutation(`/api/users/${id}`, "PUT", { ...patch, email: newEmail }, `user:${id}`);
        return { ok: true };
      },
      deleteUser: (id) => {
        const target = get().users.find((x) => x.id === id);
        if (!target) return { ok: false, error: "Utilisateur introuvable" };
        if (target.role === "ADMIN" && activeAdmins(get().users) <= 1) {
          return { ok: false, error: "Impossible de supprimer le dernier admin" };
        }
        if (get().user?.id === id) return { ok: false, error: "Vous ne pouvez pas supprimer votre propre compte" };
        set((s) => {
          const passwords = { ...s.passwords }; delete passwords[target.email];
          return { users: s.users.filter((x) => x.id !== id), passwords };
        });
        broadcastSync("kidzpos-auth");
        pushMutation(`/api/users/${id}`, "DELETE", undefined, `user:${id}`);
        return { ok: true };
      },
      setPassword: async (email, password) => {
        const hashed = await hashPassword(password);
        const e = email.toLowerCase();
        set((s) => ({ passwords: { ...s.passwords, [e]: hashed } }));
        broadcastSync("kidzpos-auth");
        const u = get().users.find((x) => x.email.toLowerCase() === e);
        if (u) pushMutation(`/api/users/${u.id}`, "PUT", { password }, `user:${u.id}`);
      },
    }),
    {
      name: "kidzpos-auth",
      version: 2,
      onRehydrateStorage: () => async (state) => {
        if (!state || !import.meta.env.DEV) return;
        const seeds: Record<string, string> = {
          "admin@kidzpos.com": "admin123",
          "sarah@kidzpos.com": "sarah123",
          "karim@kidzpos.com": "karim123",
        };
        const updates: Record<string, string> = {};
        for (const [email, pwd] of Object.entries(seeds)) {
          if (!state.passwords[email]) updates[email] = await hashPassword(pwd);
        }
        if (Object.keys(updates).length) {
          useAuth.setState((s) => ({ passwords: { ...s.passwords, ...updates } }));
        }
      },
    }
  )
);
