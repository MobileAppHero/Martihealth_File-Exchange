import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMe } from '@/hooks/use-me';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter, Redirect } from 'wouter';

import NotFound from '@/pages/not-found';
import { AppShell } from '@/components/layout/app-shell';
import SignIn from '@/pages/sign-in';
import EnrollTwoFactor from '@/pages/enroll-2fa';
import Browser from '@/pages/browser';
import AdminClients from '@/pages/admin/clients';
import AdminClientDetail from '@/pages/admin/client-detail';
import AdminUsers from '@/pages/admin/users';
import AdminAudit from '@/pages/admin/audit';

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { data, isLoading, isError } = useMe();

  if (isLoading) return null;
  if (isError || !data?.user) return <Redirect to="/sign-in" />;

  const isAdmin = data.user.role === 'admin';

  // Admins must finish TOTP enrollment before using the portal.
  if (isAdmin && !data.user.totpEnabled) return <EnrollTwoFactor />;

  return (
    <AppShell>
      <Switch>
        <Route path="/files/*?" component={Browser} />
        {isAdmin && <Route path="/admin/clients/:id" component={AdminClientDetail} />}
        {isAdmin && <Route path="/admin/clients" component={AdminClients} />}
        {isAdmin && <Route path="/admin/users" component={AdminUsers} />}
        {isAdmin && <Route path="/admin/audit" component={AdminAudit} />}
        <Route path="/">
          <Redirect to="/files" />
        </Route>
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/sign-in" component={SignIn} />
        <Route component={ProtectedRoutes} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
