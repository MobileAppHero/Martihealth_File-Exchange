import { useState } from 'react';
import { Link, useRoute } from 'wouter';
import { ArrowLeft, FolderOpen, KeyRound, Loader2, ShieldOff, Trash2 } from 'lucide-react';

import {
  useClients,
  useDeleteSshKey,
  useDisableClient,
  useImportSshKey,
  useRetryProvision,
  useSftpDetails,
} from '@/hooks/use-admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

export default function AdminClientDetail() {
  const [, params] = useRoute('/admin/clients/:id');
  const id = Number(params?.id);
  const { data: clientsData } = useClients();
  const client = clientsData?.clients.find((c) => c.id === id) ?? null;

  const { data: sftp, isLoading: sftpLoading } = useSftpDetails(Number.isInteger(id) ? id : null);
  const importKey = useImportSshKey();
  const deleteKey = useDeleteSshKey();
  const retryProvision = useRetryProvision();
  const disableClient = useDisableClient();
  const { toast } = useToast();

  const [newKey, setNewKey] = useState('');
  const [confirmDisable, setConfirmDisable] = useState(false);

  if (!client) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        {clientsData ? 'Client not found.' : 'Loading…'}
      </div>
    );
  }

  const onImportKey = (e: React.FormEvent) => {
    e.preventDefault();
    importKey.mutate(
      { id, publicKey: newKey.trim() },
      {
        onSuccess: () => {
          setNewKey('');
          toast({ title: 'SSH key imported' });
        },
        onError: (err) =>
          toast({
            title: 'Import failed',
            description: err instanceof Error ? err.message : undefined,
            variant: 'destructive',
          }),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/admin/clients" aria-label="Back to clients">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{client.displayName}</h1>
            <p className="text-xs text-muted-foreground">
              <code>{client.clientId}</code> · created {new Date(client.createdAt).toLocaleDateString()}
            </p>
          </div>
          <Badge variant={client.status === 'active' ? 'default' : 'secondary'}>{client.status}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/files/${client.clientId}`}>
              <FolderOpen className="mr-2 h-4 w-4" /> Browse files
            </Link>
          </Button>
          {client.status === 'active' && (
            <Button variant="destructive" size="sm" onClick={() => setConfirmDisable(true)}>
              <ShieldOff className="mr-2 h-4 w-4" /> Disable
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">SFTP access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {sftpLoading ? (
            <div className="flex items-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : sftp?.sftpUser ? (
            <>
              <div className="grid gap-1">
                <p>
                  <span className="text-muted-foreground">Host:</span> <code>{sftp.sftpHost}</code>
                </p>
                <p>
                  <span className="text-muted-foreground">Username:</span>{' '}
                  <code>{sftp.sftpUser.userName}</code>
                </p>
                <p>
                  <span className="text-muted-foreground">Home:</span>{' '}
                  <code>{sftp.sftpUser.homeTarget}</code>
                </p>
              </div>
              <div className="space-y-2">
                <p className="font-medium">SSH keys</p>
                {sftp.sftpUser.sshPublicKeys.length === 0 && (
                  <p className="text-muted-foreground">
                    No keys yet — SFTP sign-in is impossible until one is added.
                  </p>
                )}
                {sftp.sftpUser.sshPublicKeys.map((key) => (
                  <div key={key.keyId} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <code className="truncate text-xs">{key.fingerprint ?? key.keyId}</code>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove key"
                      onClick={() =>
                        deleteKey.mutate(
                          { id, keyId: key.keyId },
                          { onSuccess: () => toast({ title: 'SSH key removed' }) },
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <form onSubmit={onImportKey} className="space-y-2">
                <Textarea
                  placeholder="ssh-ed25519 AAAA… (paste the client's public key)"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  rows={3}
                  required
                />
                <Button type="submit" size="sm" disabled={importKey.isPending}>
                  {importKey.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Add SSH key
                </Button>
              </form>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-muted-foreground">
                No SFTP user exists for this client{client.status !== 'active' ? ' (client is disabled)' : ''}.
              </p>
              {client.status === 'active' && (
                <Button
                  size="sm"
                  onClick={() =>
                    retryProvision.mutate(id, {
                      onSuccess: () => toast({ title: 'SFTP user provisioned' }),
                      onError: (err) =>
                        toast({
                          title: 'Provisioning failed',
                          description: err instanceof Error ? err.message : undefined,
                          variant: 'destructive',
                        }),
                    })
                  }
                  disabled={retryProvision.isPending}
                >
                  {retryProvision.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Provision SFTP user
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmDisable} onOpenChange={setConfirmDisable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable {client.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their SFTP user is deleted and all of their web logins are disabled. Files are
              retained in the bucket. This can be reversed by re-provisioning.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                disableClient.mutate(id, {
                  onSuccess: () => toast({ title: 'Client disabled' }),
                })
              }
            >
              Disable client
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
