import { NextResponse } from "next/server";
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
    if (shouldTreatAsUnavailable(error.message)) {
      return billNotFound();
    }

    return NextResponse.json(
      { message: error.message || "Unable to look up the utility bill." },
      { status: 500 }
    );
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
