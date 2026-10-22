import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type FolderListing } from "@/lib/api";

export function useFolder(prefix: string) {
  return useQuery({
    queryKey: ["files", prefix],
    queryFn: () =>
      api.get<FolderListing>(`/files/list?prefix=${encodeURIComponent(prefix)}`),
  });
}

export function useCreateFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (relativePath: string) =>
      api.post("/files/create-folder", { relativePath }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["files"] }),
  });
}

// Presign + PUT. Uses XHR (not fetch) for upload progress events, mirroring
// the Tech Request Intake upload flow.
export function useUploadFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      relativePath,
      file,
      onProgress,
    }: {
      relativePath: string;
      file: File;
      onProgress?: (percent: number) => void;
    }) => {
      const contentType = file.type || "application/octet-stream";
      const { uploadURL } = await api.post<{ uploadURL: string; key: string }>(
        "/files/request-upload-url",
        { relativePath, name: file.name, size: file.size, contentType },
      );
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadURL);
        xhr.setRequestHeader("Content-Type", contentType);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && onProgress) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload failed (${xhr.status})`));
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(file);
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["files"] }),
  });
}

export function downloadUrl(key: string): string {
  return `/api/files/download/${key.split("/").map(encodeURIComponent).join("/")}`;
}
