import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDashboardAuth } from "@/lib/dashboard-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const leadIdSchema = z.string().uuid();
const utilityBillBucket = "utility-bills";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ leadId: string }> }
) {
  const authError = requireDashboardAuth(request);

  if (authError) {
    return authError;
  }

  const rateLimit = await enforceRateLimit({
    request,
    route: "api:leads:delete",
    limit: 5,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { message: "Too many delete attempts. Please try again shortly." },
      { status: 429 }
    );
  }

  const { leadId: rawLeadId } = await context.params;
  const parsedLeadId = leadIdSchema.safeParse(rawLeadId);

  if (!parsedLeadId.success) {
    return NextResponse.json({ message: "Invalid lead ID." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data: lead, error: lookupError } = await supabase
      .from("leads")
      .select("id, utility_bill_file_path")
      .eq("id", parsedLeadId.data)
      .maybeSingle();

    if (lookupError) {
      console.error("[lead-delete:error]", {
        operation: "lead-lookup",
        errorType: lookupError.code ?? "unknown",
      });
      return NextResponse.json(
        { message: "Unable to load this lead for deletion." },
        { status: 500 }
      );
    }

    if (!lead) {
      return NextResponse.json({ message: "Lead not found." }, { status: 404 });
    }

    const billPath = lead.utility_bill_file_path?.trim() ?? "";

    if (billPath) {
      const expectedPrefix = `leads/${parsedLeadId.data}/`;
      const hasSafeLeadPrefix =
        billPath.startsWith(expectedPrefix) &&
        !billPath
          .split("/")
          .some((segment: string) => segment === ".." || !segment);

      if (!hasSafeLeadPrefix) {
        console.error("[lead-delete:error]", {
          operation: "unsafe-utility-bill-path",
          leadId: parsedLeadId.data,
        });
        return NextResponse.json(
          {
            message:
              "This lead has an unexpected uploaded-file path, so it was not deleted. Please contact support.",
          },
          { status: 409 }
        );
      }

      const { error: storageError } = await supabase.storage
        .from(utilityBillBucket)
        .remove([billPath]);

      if (storageError) {
        console.error("[lead-delete:error]", {
          operation: "utility-bill-cleanup",
          errorType: storageError.name ?? "unknown",
          leadId: parsedLeadId.data,
        });
        return NextResponse.json(
          {
            message:
              "The uploaded utility bill could not be securely removed, so the lead was not deleted. Please retry.",
          },
          { status: 502 }
        );
      }
    }

    const { data: deletedLead, error: deleteError } = await supabase
      .from("leads")
      .delete()
      .eq("id", parsedLeadId.data)
      .select("id")
      .maybeSingle();

    if (deleteError || !deletedLead) {
      if (billPath) {
        const { error: clearPathError } = await supabase
          .from("leads")
          .update({
            utility_bill_file_path: null,
            utility_bill_uploaded: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", parsedLeadId.data);

        if (clearPathError) {
          console.error("[lead-delete:error]", {
            operation: "clear-removed-bill-reference",
            errorType: clearPathError.code ?? "unknown",
            leadId: parsedLeadId.data,
          });
        }
      }

      console.error("[lead-delete:error]", {
        operation: "lead-delete",
        errorType: deleteError?.code ?? (deletedLead ? "unknown" : "not-deleted"),
      });
      return NextResponse.json(
        {
          message: billPath
            ? "The uploaded bill was removed, but the lead could not be deleted. Refresh the dashboard and retry."
            : "Unable to delete this lead. Please refresh and try again.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { deletedLeadId: deletedLead.id },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("[lead-delete:error]", {
      operation: "unexpected",
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { message: "Unable to delete this lead. Please try again." },
      { status: 500 }
    );
  }
}
