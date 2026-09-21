import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireScheduledJobAuth } from "@/lib/dashboard-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bucketName = "utility-bills";
const pendingPrefix = "pending";
const maxPendingAgeMs = 24 * 60 * 60 * 1000;
const storagePageSize = 1000;

type StorageItem = {
  created_at?: string;
  id?: string | null;
  name: string;
  updated_at?: string;
};

type StorageBucket = ReturnType<
  ReturnType<typeof getSupabaseAdminClient>["storage"]["from"]
>;

async function listAllStorageItems(bucket: StorageBucket, prefix: string) {
  const items: StorageItem[] = [];

  for (let offset = 0; ; offset += storagePageSize) {
    const { data, error } = (await bucket.list(prefix, {
      limit: storagePageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    })) as {
      data: StorageItem[] | null;
      error: { message?: string } | null;
    };

    if (error) {
      return { data: null, error };
    }

    const page = data ?? [];
    items.push(...page);

    if (page.length < storagePageSize) {
      return { data: items, error: null };
    }
  }
}

async function cleanupPendingUtilityBills(request: Request) {
  const requestId = randomUUID();
  const authError = requireScheduledJobAuth(request);

  if (authError) {
    return authError;
  }

  const supabase = getSupabaseAdminClient();
  const bucket = supabase.storage.from(bucketName);
  const cutoffTime = Date.now() - maxPendingAgeMs;
  const pathsToRemove: string[] = [];

  const { data: folders, error } = await listAllStorageItems(
    bucket,
    pendingPrefix
  );

  if (error) {
    console.error("[utility-bill-cleanup:error]", {
      operation: "list-pending",
      providerErrorType: getProviderErrorType(error),
      requestId,
    });
    return NextResponse.json(
      {
        code: "UTILITY_BILL_CLEANUP_UNAVAILABLE",
        message: "Unable to inspect pending utility bills.",
        requestId,
      },
      { headers: { "Cache-Control": "no-store" }, status: 503 }
    );
  }

  for (const folder of folders ?? []) {
    const folderPrefix = `${pendingPrefix}/${folder.name}`;
    const folderDate = Date.parse(`${folder.name}T00:00:00.000Z`);
    const removeWholeFolder =
      Number.isFinite(folderDate) && folderDate < cutoffTime - maxPendingAgeMs;
    const { data: files, error: fileListError } = await listAllStorageItems(
      bucket,
      folderPrefix
    );

    if (fileListError) {
      console.error("[utility-bill-cleanup:error]", {
        operation: "list-folder",
        providerErrorType: getProviderErrorType(fileListError),
        requestId,
      });
      return NextResponse.json(
        {
          code: "UTILITY_BILL_CLEANUP_UNAVAILABLE",
          message: "Unable to inspect pending utility bills.",
          requestId,
        },
        { headers: { "Cache-Control": "no-store" }, status: 503 }
      );
    }

    for (const file of files ?? []) {
      const fileUpdatedAt = Date.parse(file.updated_at ?? file.created_at ?? "");
      const isOldFile = Number.isFinite(fileUpdatedAt)
        ? fileUpdatedAt < cutoffTime
        : removeWholeFolder;

      if (isOldFile) {
        pathsToRemove.push(`${folderPrefix}/${file.name}`);
      }
    }
  }

  let removed = 0;

  for (let offset = 0; offset < pathsToRemove.length; offset += storagePageSize) {
    const batch = pathsToRemove.slice(offset, offset + storagePageSize);
    const { error: removeError } = await bucket.remove(batch);

    if (removeError) {
      console.error("[utility-bill-cleanup:error]", {
        attempted: batch.length,
        operation: "remove-batch",
        providerErrorType: getProviderErrorType(removeError),
        requestId,
      });
      return NextResponse.json(
        {
          code: "UTILITY_BILL_CLEANUP_UNAVAILABLE",
          message: "Unable to remove expired pending utility bills.",
          removed,
          requestId,
        },
        { headers: { "Cache-Control": "no-store" }, status: 503 }
      );
    }

    removed += batch.length;
  }

  return NextResponse.json({
    removed,
  });
}

export async function GET(request: Request) {
  return cleanupPendingUtilityBills(request);
}

export async function POST(request: Request) {
  return cleanupPendingUtilityBills(request);
}

function getProviderErrorType(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : "provider_error";
}
