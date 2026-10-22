import {
  S3Client,
  GetObjectCommand,
  CopyObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

import { VALIDATED_EXTENSIONS, validateContent } from "./validators.mjs";

/**
 * marti-fx-clinical-validator
 *
 * EventBridge (S3 Object Created on clients/*) → parse-check clinical files.
 * Invalid files are MOVED to clients/<slug>/quarantine/ with a .reason.txt
 * sidecar, so both the FX portal and SFTP show the quarantine folder inside
 * the client's own jail. Valid files are left untouched. Never deletes
 * anything except the original of a file it has already copied to quarantine.
 */

const s3 = new S3Client({});
const MAX_VALIDATED_BYTES = 50 * 1024 * 1024; // larger files are logged + skipped
const QUARANTINE_DIR = "quarantine";

function extensionOf(key) {
  const base = key.slice(key.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

function logLine(fields) {
  console.log(JSON.stringify(fields));
}

export async function handler(event) {
  const bucket = event?.detail?.bucket?.name;
  const key = event?.detail?.object?.key;
  const size = event?.detail?.object?.size ?? 0;
  const eventTime = event?.time ?? "unknown-time";

  if (!bucket || !key) {
    logLine({ outcome: "skipped_malformed_event", event });
    return { outcome: "skipped_malformed_event" };
  }

  const parts = key.split("/");
  // Only clients/<slug>/<...file>; ignore folder markers and quarantined objects.
  if (parts[0] !== "clients" || parts.length < 3 || key.endsWith("/")) {
    logLine({ outcome: "skipped_out_of_scope", key });
    return { outcome: "skipped_out_of_scope", key };
  }
  if (parts.includes(QUARANTINE_DIR)) {
    logLine({ outcome: "skipped_quarantine_object", key });
    return { outcome: "skipped_quarantine_object", key };
  }

  const extension = extensionOf(key);
  if (!VALIDATED_EXTENSIONS.has(extension)) {
    logLine({ outcome: "skipped_unvalidated_type", key, extension });
    return { outcome: "skipped_unvalidated_type", key };
  }
  if (size > MAX_VALIDATED_BYTES) {
    logLine({ outcome: "skipped_too_large", key, size });
    return { outcome: "skipped_too_large", key };
  }

  let text;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    text = await obj.Body.transformToString("utf-8");
  } catch (err) {
    // Already moved/removed (e.g. duplicate event) — nothing to validate.
    if (err?.name === "NoSuchKey") {
      logLine({ outcome: "skipped_gone", key });
      return { outcome: "skipped_gone", key };
    }
    throw err;
  }

  const reason = validateContent(extension, text);
  if (reason === null) {
    logLine({ outcome: "valid", key, extension });
    return { outcome: "valid", key };
  }

  const slug = parts[1];
  const basename = parts[parts.length - 1];
  const stamp = eventTime.replace(/[:]/g, "").replace(/\.\d+Z$/, "Z");
  const quarantineKey = `clients/${slug}/${QUARANTINE_DIR}/${stamp}__${basename}`;

  // Copy first, then write the reason, then delete the original — if any step
  // fails the file is still present somewhere and the Lambda retry is safe.
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`,
      Key: quarantineKey,
      MetadataDirective: "COPY",
    })
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${quarantineKey}.reason.txt`,
      ContentType: "text/plain",
      Body: [
        `File quarantined by the Marti FX clinical validator.`,
        `Original location: ${key}`,
        `Uploaded at: ${eventTime}`,
        `Reason: ${reason}`,
        ``,
        `Fix the file and upload it again to the original folder.`,
      ].join("\n"),
    })
  );
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

  logLine({ outcome: "quarantined", key, quarantineKey, reason });
  return { outcome: "quarantined", key, quarantineKey, reason };
}
