import { useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, FolderOpen, Loader2, Plus } from 'lucide-react';

import { useClients, useCreateClient } from '@/hooks/use-admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

export default function AdminClients() {
  const { data, isLoading } = useClients();
  const createClient = useCreateClient();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [adoptSlug, setAdoptSlug] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [sshKey, setSshKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setClientId('');
    setDisplayName('');
    setSshKey('');
    setError(null);
  };

  const submit = (adopt: boolean) => (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    createClient.mutate(
      {
        clientId: adopt ? (adoptSlug ?? '') : clientId.trim(),
        displayName: displayName.trim(),
        ...(sshKey.trim() && !adopt ? { sshPublicKey: sshKey.trim() } : {}),
        ...(adopt ? { adopt: true } : {}),
      },
      {
        onSuccess: (created) => {
          setCreateOpen(false);
          setAdoptSlug(null);
          resetForm();
          const provisionError = (created as { provisionError?: string | null }).provisionError;
          if (provisionError) {
            toast({ title: 'Partially provisioned', description: provisionError, variant: 'destructive' });
          } else {
            toast({ title: adopt ? 'Client adopted' : 'Client provisioned' });
          }
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Failed'),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Clients</h1>
        <Button size="sm" onClick={() => { resetForm(); setCreateOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />
          New client
        </Button>
      </div>

      {(data?.orphanPrefixes.length ?? 0) > 0 && (
        <Card className="border-amber-300 dark:border-amber-700">
          <CardContent className="flex flex-col gap-2 py-3 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Folders without a registry entry
            </span>
            {data?.orphanPrefixes.map((slug) => (
              <div key={slug} className="flex items-center justify-between gap-2">
                <code className="text-xs">clients/{slug}/</code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    resetForm();
                    setDisplayName(slug);
                    setAdoptSlug(slug);
                  }}
                >
                  Adopt
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

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
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">SFTP</th>
                  <th className="px-4 py-3 font-medium w-28">Folder</th>
                </tr>
              </thead>
              <tbody>
                {data?.clients.map((client) => (
                  <tr key={client.id} className="border-b last:border-0 hover:bg-secondary/50">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/clients/${client.id}`} className="font-medium hover:underline">
                        {client.displayName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        <code>{client.clientId}</code>
                        {!client.hasPrefix && (
                          <span className="ml-2 text-amber-600">no folder in bucket</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={client.status === 'active' ? 'default' : 'secondary'}>
                        {client.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      {client.sftpUserCreated ? (
                        <Badge variant="outline">provisioned</Badge>
                      ) : (
                        <Badge variant="destructive">not provisioned</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/files/${client.clientId}`}>
                          <FolderOpen className="mr-1 h-4 w-4" /> Browse
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
                {!data?.clients.length && (
                  <tr>
                    <td colSpan={4} className="py-16 text-center text-muted-foreground">
                      No clients registered yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Provision a new client</DialogTitle>
            <DialogDescription>
              Creates the client folder and the jailed SFTP account. The SSH key can be added later
              if the client is web-only for now.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit(false)} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Client ID</label>
              <Input
                placeholder="e.g. acme-health"
                value={clientId}
                onChange={(e) => setClientId(e.target.value.toLowerCase())}
                pattern="[a-z0-9-]{2,40}"
                title="2-40 chars: lowercase letters, digits, hyphens"
                required
              />
              <p className="text-xs text-muted-foreground">
                Becomes the folder name and SFTP username. Lowercase letters, digits, hyphens.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Display name</label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">SSH public key (optional)</label>
              <Textarea
                placeholder="ssh-ed25519 AAAA…"
                value={sshKey}
                onChange={(e) => setSshKey(e.target.value)}
                rows={3}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={createClient.isPending}>
                {createClient.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Provision client
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Adopt dialog */}
      <Dialog open={adoptSlug !== null} onOpenChange={(open) => { if (!open) { setAdoptSlug(null); resetForm(); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Adopt {adoptSlug}</DialogTitle>
            <DialogDescription>
              Registers the existing folder <code>clients/{adoptSlug}/</code> (and its SFTP user, if
              any) without creating AWS resources.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit(true)} className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Display name</label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={createClient.isPending}>
                {createClient.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Adopt
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
