import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  api,
  type AuditResponse,
  type ClientRow,
  type ClientsResponse,
  type SftpDetails,
  type UserRow,
} from "@/lib/api";

export function useClients() {
  return useQuery({
    queryKey: ["admin", "clients"],
    queryFn: () => api.get<ClientsResponse>("/admin/clients"),
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      clientId: string;
      displayName: string;
      sshPublicKey?: string;
      adopt?: boolean;
    }) => api.post<ClientRow & { provisionError?: string | null }>("/admin/clients", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "clients"] }),
  });
}

export function useRetryProvision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post(`/admin/clients/${id}/provision-sftp`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export function useDisableClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post(`/admin/clients/${id}/disable`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export function useSftpDetails(id: number | null) {
  return useQuery({
    queryKey: ["admin", "sftp", id],
    queryFn: () => api.get<SftpDetails>(`/admin/clients/${id}/sftp`),
    enabled: id !== null,
  });
}

export function useImportSshKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, publicKey }: { id: number; publicKey: string }) =>
      api.post(`/admin/clients/${id}/ssh-keys`, { publicKey }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export function useDeleteSshKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, keyId }: { id: number; keyId: string }) =>
      api.delete(`/admin/clients/${id}/ssh-keys/${encodeURIComponent(keyId)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<UserRow[]>("/admin/users"),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      email: string;
      password: string;
      firstName?: string;
      lastName?: string;
      role: "admin" | "client";
      clientId?: number;
    }) => api.post<UserRow>("/admin/users", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useDisableUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post(`/admin/users/${id}/disable`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      api.post(`/admin/users/${id}/reset-password`, { password }),
  });
}

export function useAudit(filters: { clientId?: string; action?: string; page: number }) {
  const params = new URLSearchParams();
  if (filters.clientId) params.set("clientId", filters.clientId);
  if (filters.action) params.set("action", filters.action);
  params.set("page", String(filters.page));
  return useQuery({
    queryKey: ["admin", "audit", filters],
    queryFn: () => api.get<AuditResponse>(`/admin/audit?${params.toString()}`),
  });
}
