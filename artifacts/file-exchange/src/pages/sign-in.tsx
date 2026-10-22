import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { FolderLock, Loader2 } from 'lucide-react';

import { api, ApiError, type Me } from '@/lib/api';
import { ME_QUERY_KEY } from '@/hooks/use-me';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function SignIn() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: (body: { email: string; password: string; totpCode?: string }) =>
      api.post<Me>('/auth/login', body),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    login.mutate(
      {
        email: email.trim(),
        password,
        ...(totpRequired && totpCode ? { totpCode: totpCode.trim() } : {}),
      },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(ME_QUERY_KEY, data);
          setLocation('/files');
        },
        onError: (err) => {
          if (err instanceof ApiError && err.totpRequired) {
            setTotpRequired(true);
            if (totpCode) setError(err.message);
          } else {
            setError(err instanceof ApiError ? err.message : 'Sign in failed.');
          }
        },
      },
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50/50 dark:bg-zinc-950 p-4">
      <Card className="w-full max-w-sm shadow-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FolderLock className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">Marti FX</CardTitle>
          <CardDescription>Secure file exchange</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium leading-none">
                Email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={totpRequired}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium leading-none">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={totpRequired}
              />
            </div>
            {totpRequired && (
              <div className="space-y-2">
                <label htmlFor="totp" className="text-sm font-medium leading-none">
                  Verification code
                </label>
                <Input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  required
                  autoFocus
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Enter the code from your authenticator app.
                </p>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {totpRequired ? 'Verify' : 'Sign In'}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Access is by invitation only.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
