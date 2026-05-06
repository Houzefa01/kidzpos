import { useState } from "react";
import { useAuth, Role } from "@/store/auth";
import { useData } from "@/store/data";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Plus, ShieldCheck, UserCog, KeyRound, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface UserForm {
  name: string;
  email: string;
  password: string;
  role: Role;
  storeId: string;
}

export default function Users() {
  const { user: current, users, addUser, toggleUser, updateUser, deleteUser, setPassword } = useAuth();
  const { stores } = useData();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pwdUser, setPwdUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [newPwd, setNewPwd] = useState("");
  const [isSubmittingPwd, setIsSubmittingPwd] = useState(false);
  const [form, setForm] = useState<UserForm>({
    name: "", email: "", password: "", role: "EMPLOYEE", storeId: stores[0]?.id ?? "s1",
  });

  if (current?.role !== "ADMIN") {
    return <div className="p-8 text-center text-sm text-muted-foreground">Accès réservé aux administrateurs.</div>;
  }

  const reset = () => {
    setEditingId(null);
    setForm({ name: "", email: "", password: "", role: "EMPLOYEE", storeId: stores[0]?.id ?? "s1" });
  };

  const openCreate = () => { reset(); setOpen(true); };
  const openEdit = (id: string) => {
    const u = users.find((x) => x.id === id);
    if (!u) return;
    setEditingId(id);
    setForm({ name: u.name, email: u.email, password: "", role: u.role, storeId: u.storeId ?? stores[0]?.id ?? "s1" });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim() || !form.email.trim()) { toast.error("Nom et email requis"); return; }
    if (editingId) {
      const res = updateUser(editingId, {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        role: form.role,
        storeId: form.role === "ADMIN" ? null : form.storeId,
      });
      if (!res.ok) { toast.error(res.error ?? "Erreur"); return; }
      if (form.password) await setPassword(form.email.trim().toLowerCase(), form.password);
      toast.success("Utilisateur mis à jour");
    } else {
      if (!form.password) { toast.error("Mot de passe requis"); return; }
      const res = await addUser({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        role: form.role,
        storeId: form.role === "ADMIN" ? null : form.storeId,
        active: true,
      }, form.password);
      if (!res.ok) { toast.error(res.error ?? "Erreur"); return; }
      toast.success("Utilisateur créé");
    }
    setOpen(false);
    reset();
  };

  const onToggle = (id: string) => {
    const res = toggleUser(id);
    if (!res.ok) toast.error(res.error ?? "Erreur");
  };

  const onDelete = (id: string) => {
    const res = deleteUser(id);
    if (!res.ok) toast.error(res.error ?? "Erreur");
    else toast.success("Utilisateur supprimé");
  };

  const submitPwd = async () => {
    if (!pwdUser || newPwd.length < 4) { toast.error("Mot de passe trop court (4 min)"); return; }
    if (isSubmittingPwd) return;
    setIsSubmittingPwd(true);
    try {
      await setPassword(pwdUser.email, newPwd);
      toast.success(`Mot de passe mis à jour pour ${pwdUser.name}`);
      setPwdUser(null);
      setNewPwd("");
    } finally {
      setIsSubmittingPwd(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Utilisateurs</h1>
          <p className="text-sm text-muted-foreground">Gestion des comptes admin et caissiers — admin uniquement.</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
          <DialogTrigger asChild>
            <Button className="gradient-primary text-primary-foreground hover:opacity-90" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> Nouvel utilisateur
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingId ? "Modifier" : "Créer"} un utilisateur</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-2">
                <Label>Nom complet</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Mot de passe {editingId && <span className="text-xs text-muted-foreground">(laisser vide = inchangé)</span>}</Label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Rôle</Label>
                <Select value={form.role} onValueChange={(v: Role) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADMIN">Administrateur</SelectItem>
                    <SelectItem value="EMPLOYEE">Caissier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.role === "EMPLOYEE" && (
                <div className="space-y-2">
                  <Label>Magasin</Label>
                  <Select value={form.storeId} onValueChange={(v) => setForm({ ...form, storeId: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button className="gradient-primary text-primary-foreground" onClick={submit}>{editingId ? "Mettre à jour" : "Créer"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="gradient-card border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Utilisateur</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead>Magasin</TableHead>
              <TableHead className="text-right">Mot de passe</TableHead>
              <TableHead className="text-right">Actif</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                  Aucun utilisateur. Cliquez sur « Nouvel utilisateur » pour commencer.
                </TableCell>
              </TableRow>
            )}
            {users.map((u) => {
              const store = stores.find((s) => s.id === u.storeId);
              return (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {u.role === "ADMIN" ? <ShieldCheck className="h-4 w-4 text-primary" /> : <UserCog className="h-4 w-4 text-accent" />}
                      {u.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "ADMIN" ? "default" : "secondary"} className={u.role === "ADMIN" ? "gradient-primary text-primary-foreground" : ""}>
                      {u.role === "ADMIN" ? "Admin" : "Caissier"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{store ? store.name.split("—")[0] : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setPwdUser({ id: u.id, email: u.email, name: u.name })}>
                      <KeyRound className="mr-1 h-3 w-3" /> Changer
                    </Button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch checked={u.active} onCheckedChange={() => onToggle(u.id)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(u.id)}><Pencil className="h-4 w-4" /></Button>
                      <ConfirmDialog
                        trigger={<Button size="icon" variant="ghost" disabled={u.id === current.id}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                        title={`Supprimer ${u.name} ?`}
                        description="Cette action est irréversible. Le compte ne pourra plus se connecter."
                        destructive
                        onConfirm={() => onDelete(u.id)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!pwdUser} onOpenChange={(v) => { if (!v) { setPwdUser(null); setNewPwd(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Changer le mot de passe</DialogTitle></DialogHeader>
          {pwdUser && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Pour <span className="font-medium text-foreground">{pwdUser.name}</span></p>
              <Input type="text" placeholder="Nouveau mot de passe" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoFocus />
            </div>
          )}
          <DialogFooter>
            <Button className="gradient-primary text-primary-foreground" onClick={submitPwd} disabled={isSubmittingPwd || newPwd.length < 4}>
              {isSubmittingPwd ? "Mise à jour…" : "Mettre à jour"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
