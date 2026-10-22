import { useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Download,
  File as FileIcon,
  Folder,
  FolderPlus,
  Home,
  Loader2,
  Upload,
} from 'lucide-react';

import { useMe } from '@/hooks/use-me';
import { downloadUrl, useCreateFolder, useFolder, useUploadFile } from '@/hooks/use-files';
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
import { useToast } from '@/hooks/use-toast';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function Browser() {
  const [location] = useLocation();
  const { data: me } = useMe();
  const { toast } = useToast();

  // Relative path within the caller's root, from the URL: /files/<rel-path>
  const relPrefix = decodeURIComponent(location.replace(/^\/files\/?/, '')).replace(/\/+$/, '');
  const segments = relPrefix === '' ? [] : relPrefix.split('/');

  const { data, isLoading, isError } = useFolder(relPrefix);
  const upload = useUploadFile();
  const createFolder = useCreateFolder();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<{ name: string; percent: number } | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const isAdmin = me?.user?.role === 'admin';
  const atAdminRoot = isAdmin && segments.length === 0;

  const uploadFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      setUploadProgress({ name: file.name, percent: 0 });
      try {
        await upload.mutateAsync({
          relativePath: relPrefix,
          file,
          onProgress: (percent) => setUploadProgress({ name: file.name, percent }),
        });
        toast({ title: 'Uploaded', description: file.name });
      } catch (err) {
        toast({
          title: 'Upload failed',
          description: err instanceof Error ? err.message : file.name,
          variant: 'destructive',
        });
      }
    }
    setUploadProgress(null);
  };

  const onCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newFolderName.trim().replace(/\/+/g, '');
    if (!name) return;
    createFolder.mutate(relPrefix ? `${relPrefix}/${name}` : name, {
      onSuccess: () => {
        setNewFolderOpen(false);
        setNewFolderName('');
      },
      onError: (err) =>
        toast({
          title: 'Could not create folder',
          description: err instanceof Error ? err.message : undefined,
          variant: 'destructive',
        }),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex items-center gap-1 text-sm min-w-0 flex-wrap">
          <Link
            href="/files"
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <Home className="h-4 w-4" />
            {isAdmin ? 'All clients' : 'My files'}
          </Link>
          {segments.map((segment, i) => (
            <span key={i} className="flex items-center gap-1 min-w-0">
              <span className="text-muted-foreground">/</span>
              {i === segments.length - 1 ? (
                <span className="font-medium truncate">{segment}</span>
              ) : (
                <Link
                  href={`/files/${segments.slice(0, i + 1).join('/')}`}
                  className="text-muted-foreground hover:text-foreground truncate"
                >
                  {segment}
                </Link>
              )}
            </span>
          ))}
        </nav>
        {!atAdminRoot && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setNewFolderOpen(true)}>
              <FolderPlus className="mr-2 h-4 w-4" />
              New folder
            </Button>
            <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={!!uploadProgress}>
              {uploadProgress ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Upload
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void uploadFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>

      {uploadProgress && (
        <div className="rounded-md border bg-card px-4 py-2 text-sm">
          Uploading <span className="font-medium">{uploadProgress.name}</span> —{' '}
          {uploadProgress.percent}%
          <div className="mt-1 h-1.5 w-full rounded bg-secondary">
            <div
              className="h-1.5 rounded bg-primary transition-all"
              style={{ width: `${uploadProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      <Card
        className={dragOver ? 'ring-2 ring-primary' : undefined}
        onDragOver={(e) => {
          if (atAdminRoot) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (atAdminRoot) return;
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
        }}
      >
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : isError ? (
            <div className="py-16 text-center text-sm text-destructive">
              Could not load this folder.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium w-28">Size</th>
                  <th className="px-4 py-3 font-medium w-48">Modified</th>
                  <th className="px-4 py-3 w-16" />
                </tr>
              </thead>
              <tbody>
                {data?.folders.map((folder) => (
                  <tr key={folder} className="border-b last:border-0 hover:bg-secondary/50">
                    <td className="px-4 py-2.5" colSpan={3}>
                      <Link
                        href={`/files/${relPrefix ? `${relPrefix}/` : ''}${folder}`}
                        className="flex items-center gap-2 font-medium hover:underline"
                      >
                        <Folder className="h-4 w-4 text-primary" />
                        {folder}
                      </Link>
                    </td>
                    <td />
                  </tr>
                ))}
                {data?.files.map((file) => (
                  <tr key={file.key} className="border-b last:border-0 hover:bg-secondary/50">
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2 min-w-0">
                        <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{file.name}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{formatSize(file.size)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {formatDate(file.lastModified)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button asChild variant="ghost" size="icon" aria-label={`Download ${file.name}`}>
                        <a href={downloadUrl(file.key)}>
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </td>
                  </tr>
                ))}
                {!data?.folders.length && !data?.files.length && (
                  <tr>
                    <td colSpan={4} className="py-16 text-center text-muted-foreground">
                      {atAdminRoot ? 'No client folders yet.' : 'This folder is empty.'}
                      {!atAdminRoot && ' Drag and drop files here or use Upload.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>Create a folder in the current location.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreateFolder} className="space-y-3">
            <Input
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              autoFocus
              required
            />
            <DialogFooter>
              <Button type="submit" disabled={createFolder.isPending}>
                {createFolder.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
