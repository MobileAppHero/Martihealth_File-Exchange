import { useState } from 'react';
import { KeyRound, Loader2, Plus, UserX } from 'lucide-react';

import {
  useClients,
  useCreateUser,
  useDisableUser,
  useResetPassword,
  useUsers,
} from '@/hooks/use-admin';
import { useMe } from '@/hooks/use-me';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

export default function AdminUsers() {
  const { data: users, isLoading } = useUsers();
  const { data: clientsData } = useClients();
  const { data: me } = useMe();
  const createUser = useCreateUser();
  const disableUser = useDisableUser();
  const resetPassword = useResetPassword();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<'admin' | 'client'>('client');
  const [clientId, setClientId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const activeClients = clientsData?.clients.filter((c) => c.status === 'active') ?? [];
  const clientName = (id: number | null) =>
    clientsData?.clients.find((c) => c.id === id)?.displayName ?? '—';

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    createUser.mutate(
      {
        email: email.trim(),
        password,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        role,
        ...(role === 'client' ? { clientId: Number(clientId) } : {}),
      },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setEmail(''); setPassword(''); setFirstName(''); setLastName('');
          setRole('client'); setClientId('');
          toast({ title: 'User created' });
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Failed'),
      },
    );
  };

  const onReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (resetUserId === null) return;
    resetPassword.mutate(
      { id: resetUserId, password },
      {
        onSuccess: () => {
          setResetUserId(null);
          setPassword('');
          toast({ title: 'Password reset' });
        },
        onError: (err) =>
          toast({
            title: 'Reset failed',
            description: err instanceof Error ? err.message : undefined,
            variant: 'destructive',
          }),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Users</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New user
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 w-24" />
                </tr>
              </thead>
              <tbody>
                {users?.map((user) => (
                  <tr key={user.id} className="border-b last:border-0 hover:bg-secondary/50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{user.name}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={user.role === 'admin' ? 'default' : 'outline'}>
                        {user.role}
                      </Badge>
                      {user.role === 'admin' && !user.totpEnabled && (
                        <span className="ml-2 text-xs text-amber-600">2FA pending</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {user.role === 'client' ? clientName(user.clientId) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={user.status === 'active' ? 'outline' : 'secondary'}>
                        {user.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Reset password"
                        onClick={() => { setPassword(''); setResetUserId(user.id); }}
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      {user.status === 'active' && user.id !== me?.user?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Disable user"
                          onClick={() =>
                            disableUser.mutate(user.id, {
                              onSuccess: () => toast({ title: 'User disabled' }),
                            })
                          }
                        >
                          <UserX className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>
              Client users see only their client's folder. Admins see everything and must enroll in
              2FA at first sign-in.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <Input placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input
              type="password"
              placeholder="Temporary password (min 12 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <Select value={role} onValueChange={(value) => setRole(value as 'admin' | 'client')}>
                <SelectTrigger><SelectValue placeholder="Role" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              {role === 'client' && (
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
                  <SelectContent>
                    {activeClients.map((client) => (
                      <SelectItem key={client.id} value={String(client.id)}>
                        {client.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={createUser.isPending || (role === 'client' && !clientId)}>
                {createUser.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create user
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={resetUserId !== null} onOpenChange={(open) => { if (!open) setResetUserId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
          </DialogHeader>
          <form onSubmit={onReset} className="space-y-3">
            <Input
              type="password"
              placeholder="New password (min 12 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
              required
              autoFocus
            />
            <DialogFooter>
              <Button type="submit" disabled={resetPassword.isPending}>
                {resetPassword.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Reset
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
