import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, ShieldCheck } from 'lucide-react';

import { api } from '@/lib/api';
import { ME_QUERY_KEY } from '@/hooks/use-me';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type EnrollResponse = { otpauthUrl: string; qrDataUrl: string; secret: string };

// Gate page: admins land here after sign-in until TOTP enrollment completes.
export default function EnrollTwoFactor() {
  const queryClient = useQueryClient();
  const [enrollment, setEnrollment] = useState<EnrollResponse | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const enroll = useMutation({
    mutationFn: () => api.post<EnrollResponse>('/auth/totp/enroll'),
    onSuccess: setEnrollment,
    onError: () => setError('Could not start enrollment. Try again.'),
  });

  const verify = useMutation({
    mutationFn: () => api.post('/auth/totp/verify', { code: code.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
    onError: () => setError('That code is incorrect. Try again.'),
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50/50 dark:bg-zinc-950 p-4">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">Set up two-factor authentication</CardTitle>
          <CardDescription>
            Administrator accounts require an authenticator app (e.g. Google Authenticator or
            1Password) before accessing the portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!enrollment ? (
            <Button className="w-full" onClick={() => enroll.mutate()} disabled={enroll.isPending}>
              {enroll.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Generate QR code
            </Button>
          ) : (
            <>
              <div className="flex justify-center">
                <img
                  src={enrollment.qrDataUrl}
                  alt="TOTP enrollment QR code"
                  className="rounded-md border"
                  width={240}
                  height={240}
                />
              </div>
              <p className="text-center text-xs text-muted-foreground break-all">
                Can't scan? Enter this key manually: <code>{enrollment.secret}</code>
              </p>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  verify.mutate();
                }}
              >
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Enter the 6-digit code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={verify.isPending}>
                  {verify.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Confirm and finish
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
