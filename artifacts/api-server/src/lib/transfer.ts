import {
  CreateUserCommand,
  DeleteSshPublicKeyCommand,
  DeleteUserCommand,
  DescribeUserCommand,
  ImportSshPublicKeyCommand,
  TransferClient,
} from "@aws-sdk/client-transfer";

// Port of sftpautomation/scripts/add-sftp-user.ts: provisioning keeps the
// exact user shape of the CLI-created users (UHC, roni) — shared base role,
// LOGICAL home mapping, inline scope-down session policy jailing the user to
// clients/<clientId>/*.

export const transfer = new TransferClient({
  region: process.env.AWS_REGION || "us-east-1",
});

export const CLIENT_ID_PATTERN = /^[a-z0-9-]{2,40}$/;

function serverId(): string {
  const value = process.env.SFTP_SERVER_ID;
  if (!value) throw new Error("SFTP_SERVER_ID environment variable is required");
  return value;
}

function userRoleArn(): string {
  const value = process.env.SFTP_USER_ROLE_ARN;
  if (!value) throw new Error("SFTP_USER_ROLE_ARN environment variable is required");
  return value;
}

export function sftpEndpointHost(): string {
  return `${serverId()}.server.transfer.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com`;
}

export type SftpUserInfo = {
  userName: string;
  homeTarget: string | null;
  sshPublicKeys: { keyId: string; fingerprint: string | null }[];
};

export async function describeSftpUser(clientId: string): Promise<SftpUserInfo | null> {
  try {
    const result = await transfer.send(
      new DescribeUserCommand({ ServerId: serverId(), UserName: clientId }),
    );
    const user = result.User;
    return {
      userName: clientId,
      homeTarget: user?.HomeDirectoryMappings?.[0]?.Target ?? null,
      sshPublicKeys: (user?.SshPublicKeys ?? []).map((key) => ({
        keyId: key.SshPublicKeyId ?? "",
        fingerprint: key.SshPublicKeyBody
          ? key.SshPublicKeyBody.split(" ").slice(0, 2).join(" ").slice(0, 60) + "…"
          : null,
      })),
    };
  } catch (err) {
    if ((err as { name?: string }).name === "ResourceNotFoundException") return null;
    throw err;
  }
}

export async function createSftpUser(bucket: string, clientId: string): Promise<void> {
  const sessionPolicy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "ListJailedHome",
        Effect: "Allow",
        Action: ["s3:ListBucket"],
        Resource: `arn:aws:s3:::${bucket}`,
        Condition: {
          StringLike: {
            "s3:prefix": [`clients/${clientId}/*`, `clients/${clientId}`],
          },
        },
      },
      {
        Sid: "ReadWriteJailedHome",
        Effect: "Allow",
        Action: [
          "s3:PutObject",
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:DeleteObject",
          "s3:DeleteObjectVersion",
          "s3:GetObjectACL",
          "s3:PutObjectACL",
        ],
        Resource: `arn:aws:s3:::${bucket}/clients/${clientId}/*`,
      },
    ],
  };

  await transfer.send(
    new CreateUserCommand({
      ServerId: serverId(),
      UserName: clientId,
      Role: userRoleArn(),
      HomeDirectoryType: "LOGICAL",
      HomeDirectoryMappings: [{ Entry: "/", Target: `/${bucket}/clients/${clientId}` }],
      Policy: JSON.stringify(sessionPolicy),
      Tags: [
        { Key: "Project", Value: "marti-sftp-automation" },
        { Key: "ClientId", Value: clientId },
        { Key: "ProvisionedBy", Value: "file-exchange-portal" },
      ],
    }),
  );
}

const SSH_KEY_PREFIXES = ["ssh-rsa ", "ssh-ed25519 ", "ecdsa-sha2-", "sk-ssh-ed25519@", "sk-ecdsa-sha2-"];

export function looksLikeSshPublicKey(key: string): boolean {
  const trimmed = key.trim();
  return (
    SSH_KEY_PREFIXES.some((prefix) => trimmed.startsWith(prefix)) &&
    !trimmed.includes("PRIVATE KEY") &&
    !trimmed.includes("\n")
  );
}

export async function importSshKey(clientId: string, publicKey: string): Promise<string> {
  const result = await transfer.send(
    new ImportSshPublicKeyCommand({
      ServerId: serverId(),
      UserName: clientId,
      SshPublicKeyBody: publicKey.trim(),
    }),
  );
  return result.SshPublicKeyId ?? "";
}

export async function deleteSshKey(clientId: string, keyId: string): Promise<void> {
  await transfer.send(
    new DeleteSshPublicKeyCommand({
      ServerId: serverId(),
      UserName: clientId,
      SshPublicKeyId: keyId,
    }),
  );
}

// Idempotent: deleting an already-absent user is a no-op.
export async function deleteSftpUser(clientId: string): Promise<void> {
  try {
    await transfer.send(
      new DeleteUserCommand({ ServerId: serverId(), UserName: clientId }),
    );
  } catch (err) {
    if ((err as { name?: string }).name === "ResourceNotFoundException") return;
    throw err;
  }
}
