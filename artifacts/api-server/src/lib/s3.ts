import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { landingBucket } from "./authz";

// Thin presign/list layer over the SFTP landing bucket. No file bytes transit
// this process: uploads are presigned PUTs, downloads presigned GETs. Keys are
// always pre-authorized through lib/authz before reaching these helpers.
export const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
});

export function sanitizeFilename(name: string): string {
  const base = name.split("/").pop()?.split("\\").pop() ?? "file";
  return base.replace(/[^A-Za-z0-9._()\- ]+/g, "_").slice(0, 160).trim() || "file";
}

export type FolderListing = {
  folders: string[]; // folder names (single segment, no trailing slash)
  files: { name: string; key: string; size: number; lastModified: string }[];
};

// One level of the tree at `prefix` (must end with '/'). SFTP-created
// subdirectories appear as CommonPrefixes; the zero-byte folder-marker object
// (key === prefix) is skipped.
export async function listFolder(prefix: string): Promise<FolderListing> {
  const folders: string[] = [];
  const files: FolderListing["files"] = [];
  let continuationToken: string | undefined;

  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: landingBucket(),
        Prefix: prefix,
        Delimiter: "/",
        ContinuationToken: continuationToken,
      }),
    );
    for (const cp of page.CommonPrefixes ?? []) {
      if (!cp.Prefix) continue;
      const name = cp.Prefix.slice(prefix.length).replace(/\/$/, "");
      if (name) folders.push(name);
    }
    for (const obj of page.Contents ?? []) {
      if (!obj.Key || obj.Key === prefix || obj.Key.endsWith("/")) continue;
      files.push({
        name: obj.Key.slice(prefix.length),
        key: obj.Key,
        size: obj.Size ?? 0,
        lastModified: obj.LastModified?.toISOString() ?? "",
      });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  folders.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { folders, files };
}

// Top-level client prefixes (admin root view).
export async function listClientPrefixes(): Promise<string[]> {
  const { folders } = await listFolder("clients/");
  return folders;
}

export async function createFolderMarker(prefix: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: landingBucket(), Key: prefix, Body: "" }),
  );
}

export async function presignUpload(options: {
  key: string;
  contentType: string;
}): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: landingBucket(),
      Key: options.key,
      ContentType: options.contentType,
    }),
    { expiresIn: 900 },
  );
}

export async function presignDownload(key: string): Promise<string> {
  const filename = sanitizeFilename(key.split("/").pop() ?? "file");
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: landingBucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }),
    { expiresIn: 300 },
  );
}
