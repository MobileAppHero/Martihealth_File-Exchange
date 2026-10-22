import { useQuery } from "@tanstack/react-query";

import { api, type Me } from "@/lib/api";

export const ME_QUERY_KEY = ["me"] as const;

// Shared session query: one cache entry for route gating, the app shell, and
// the sign-in page.
export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => api.get<Me>("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
}
