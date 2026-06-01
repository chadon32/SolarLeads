import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createUtilityBillUploadClaim } from "@/lib/utility-bill-claims";

export const runtime = "nodejs";

const bucketName = "utility-bills";
const allowedMimeTypes = ["application/pdf", "image/jpeg", "image/png"];
const maxFileSizeBytes = 10 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const rateLimit = await enforceRateLimit({
      request,
      route: "api:utility-bills",
      limit: 10,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Too many utility bill uploads. Please try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": rateLimit.retryAfterSeconds.toString(),
          },
        }
      );
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        {
          message:
            "Utility bill storage is not connected yet. You can still submit the report without the upload.",
          uploaded: false,
        },
        { status: 503 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("bill");

    if (!isUploadFile(file)) {
      return NextResponse.json(
        { message: "Upload a PDF, JPG, or PNG utility bill.", uploaded: false },
        { status: 400 }
      );
    }

    if (!allowedMimeTypes.includes(file.type)) {
      return NextResponse.json(
        { message: "Upload a PDF, JPG, or PNG utility bill.", uploaded: false },
        { status: 400 }
      );
    }

    if (file.size > maxFileSizeBytes) {
      return NextResponse.json(
        { message: "Utility bill uploads must be 10MB or smaller.", uploaded: false },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const existingBucket = await supabase.storage.getBucket(bucketName);

    if (existingBucket.error) {
      const createdBucket = await supabase.storage.createBucket(bucketName, {
        allowedMimeTypes,
        fileSizeLimit: maxFileSizeBytes,
        public: false,
      });

      if (
        createdBucket.error &&
        !createdBucket.error.message.toLowerCase().includes("already")
      ) {
        throw createdBucket.error;
      }
    }

    const extension = getSafeExtension(file.name, file.type);
    const filePath = `pending/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${extension}`;
    const upload = await supabase.storage
      .from(bucketName)
      .upload(filePath, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: false,
      });

    if (upload.error) {
      return NextResponse.json(
        {
          message:
            "Utility bill storage is not ready yet. You can still submit the report without the upload.",
          uploaded: false,
        },
        { status: 503 }
      );
    }

    const uploadClaim = createUtilityBillUploadClaim(upload.data.path);

    if (!uploadClaim) {
      await supabase.storage.from(bucketName).remove([upload.data.path]);

      return NextResponse.json(
        {
          message:
            "Utility bill upload security is not configured. You can still submit the report without the upload.",
          uploaded: false,
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      message: "Bill uploaded - estimate ready for review",
      uploadClaim,
      uploaded: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unable to upload the utility bill. You can still submit without it.",
        uploaded: false,
      },
      { status: 500 }
    );
  }
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value &&
    "type" in value
  );
}

function getSafeExtension(fileName: string, mimeType: string) {
  const extension = fileName.toLowerCase().match(/\.(pdf|jpg|jpeg|png)$/)?.[0];

  if (extension) {
    return extension === ".jpeg" ? ".jpg" : extension;
  }

  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  return ".jpg";
}
