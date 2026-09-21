import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { verifyDashboardRequest } from "@/lib/dashboard-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bucketName = "utility-bills";
const signedUrlTtlSeconds = 60;

type UtilityBillLead = {
  id: string;
  name?: string | null;
  utility_bill_file_path?: string | null;
  utility_bill_uploaded?: boolean | null;
};

export async function GET(request: Request) {
  const requestId = randomUUID();
  const url = new URL(request.url);
  const auth = verifyDashboardRequest(request);

  if (!auth.ok) {
    return NextResponse.json(
      { message: "Utility bill access is restricted to dashboard admins." },
      { status: 403 }
    );
  }

  const leadId = url.searchParams.get("leadId")?.trim();

  if (!leadId) {
    return NextResponse.json(
      { message: "leadId is required." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = (await supabase
    .from("leads")
    .select("id, name, utility_bill_uploaded, utility_bill_file_path")
    .eq("id", leadId)
    .maybeSingle()) as {
    data: UtilityBillLead | null;
    error: { message?: string } | null;
  };

  if (error) {
    console.error("[utility-bill-download:error]", {
      operation: "lead-lookup",
      providerErrorType: getProviderErrorType(error),
      requestId,
    });

    if (shouldTreatAsUnavailable(error.message)) {
      return billNotFound();
    }

    return providerErrorResponse(requestId);
  }

  if (!data?.utility_bill_uploaded || !data.utility_bill_file_path) {
    return billNotFound();
  }

  const signedUrl = await supabase.storage
    .from(bucketName)
    .createSignedUrl(data.utility_bill_file_path, signedUrlTtlSeconds, {
      download: buildUtilityBillFilename(data),
    });

  if (signedUrl.error || !signedUrl.data?.signedUrl) {
    console.error("[utility-bill-download:error]", {
      operation: "signed-url",
      providerErrorType: signedUrl.error
        ? getProviderErrorType(signedUrl.error)
        : "missing_signed_url",
      requestId,
    });
    return billNotFound();
  }

  if (url.searchParams.get("format") === "json") {
    return NextResponse.json(
      {
        expiresInSeconds: signedUrlTtlSeconds,
        url: signedUrl.data.signedUrl,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const response = NextResponse.redirect(signedUrl.data.signedUrl, 302);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function providerErrorResponse(requestId: string) {
  return NextResponse.json(
    {
      code: "UTILITY_BILL_PROVIDER_UNAVAILABLE",
      message: "Unable to access the utility bill right now.",
      requestId,
    },
    {
      headers: { "Cache-Control": "no-store" },
      status: 503,
    }
  );
}

function billNotFound() {
  return NextResponse.json(
    { message: "Utility bill unavailable for this lead." },
    { status: 404 }
  );
}

function shouldTreatAsUnavailable(message?: string) {
  const normalized = message?.toLowerCase() ?? "";

  return (
    normalized.includes("column") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find") ||
    normalized.includes("does not exist")
  );
}

function getProviderErrorType(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : "provider_error";
}

function buildUtilityBillFilename(lead: UtilityBillLead) {
  const safeName =
    lead.name
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "lead";
  const extension =
    lead.utility_bill_file_path?.toLowerCase().match(/\.(pdf|jpg|jpeg|png)$/)?.[0] ??
    ".pdf";

  return `utility-bill-${safeName}-${lead.id.slice(0, 8)}${extension}`;
}
