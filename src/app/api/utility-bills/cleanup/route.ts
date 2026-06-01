import { NextResponse } from "next/server";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bucketName = "utility-bills";
const pendingPrefix = "pending";
const maxPendingAgeMs = 24 * 60 * 60 * 1000;

type StorageItem = {
  created_at?: string;
  id?: string | null;
  name: string;
  updated_at?: string;
};

export async function POST(request: Request) {
  const authError = requireDashboardAuth(request);

  if (authError) {
    return authError;
  }

  const supabase = getSupabaseAdminClient();
  const bucket = supabase.storage.from(bucketName);
  const cutoffTime = Date.now() - maxPendingAgeMs;
  const pathsToRemove: string[] = [];

  const { data: folders, error } = (await bucket.list(pendingPrefix, {
    limit: 1000,
  })) as { data: StorageItem[] | null; error: { message?: string } | null };

  if (error) {
    return NextResponse.json(
      { message: error.message || "Unable to inspect pending utility bills." },
      { status: 500 }
    );
  }

  for (const folder of folders ?? []) {
    const folderPrefix = `${pendingPrefix}/${folder.name}`;
    const folderDate = Date.parse(`${folder.name}T00:00:00.000Z`);
    const removeWholeFolder =
      Number.isFinite(folderDate) && folderDate < cutoffTime - maxPendingAgeMs;
    const { data: files } = (await bucket.list(folderPrefix, {
      limit: 1000,
    })) as { data: StorageItem[] | null };

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

  if (pathsToRemove.length) {
    await bucket.remove(pathsToRemove);
  }

  return NextResponse.json({
    removed: pathsToRemove.length,
  });
}
