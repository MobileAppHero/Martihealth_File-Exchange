import { useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

import { useAudit, useClients } from '@/hooks/use-admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ACTIONS = [
  'login', 'login_failed', 'list', 'upload_url', 'download', 'create_folder',
  'client_created', 'client_adopted', 'client_disabled',
  'sftp_user_created', 'sftp_key_imported', 'sftp_key_deleted', 'sftp_user_deleted',
  'user_created', 'user_disabled', 'user_password_reset', 'totp_enrolled',
];

const ALL = '__all__';

export default function AdminAudit() {
  const [clientId, setClientId] = useState<string>(ALL);
  const [action, setAction] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const { data: clientsData } = useClients();

  const { data, isLoading } = useAudit({
    clientId: clientId === ALL ? undefined : clientId,
    action: action === ALL ? undefined : action,
    page,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <div className="flex items-center gap-2">
          <Select value={clientId} onValueChange={(value) => { setClientId(value); setPage(0); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All clients" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All clients</SelectItem>
              {clientsData?.clients.map((client) => (
                <SelectItem key={client.id} value={client.clientId}>
                  {client.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={action} onValueChange={(value) => { setAction(value); setPage(0); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All actions" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All actions</SelectItem>
              {ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
                  <th className="px-4 py-3 font-medium w-44">When</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Object</th>
                  <th className="px-4 py-3 font-medium w-32">IP</th>
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleString(undefined, {
                        dateStyle: 'short',
                        timeStyle: 'medium',
                      })}
                    </td>
                    <td className="px-4 py-2">{row.actorEmail}</td>
                    <td className="px-4 py-2">
                      <Badge variant={row.action.includes('failed') ? 'destructive' : 'outline'}>
                        {row.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{row.clientId ?? ''}</td>
                    <td className="px-4 py-2">
                      <code className="text-xs break-all">{row.s3Key ?? ''}</code>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{row.ip ?? ''}</td>
                  </tr>
                ))}
                {!data?.rows.length && (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-muted-foreground">
                      No audit entries match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
        <span>
          Page {page + 1} of {totalPages} ({data?.total ?? 0} entries)
        </span>
        <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={page + 1 >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
