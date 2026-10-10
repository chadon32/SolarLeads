import assert from "node:assert/strict";
import test from "node:test";
import {
  UTILITY_BILL_MAX_FILE_SIZE_BYTES,
  UTILITY_BILL_MAX_FILE_SIZE_MESSAGE,
  UTILITY_BILL_MAX_REQUEST_SIZE_BYTES,
  getUtilityBillMimeType,
} from "../src/lib/utility-bill-upload";

test("utility bill limits leave multipart overhead below the platform body cap", () => {
  assert.equal(UTILITY_BILL_MAX_FILE_SIZE_BYTES, 4 * 1024 * 1024);
  assert.ok(UTILITY_BILL_MAX_REQUEST_SIZE_BYTES > UTILITY_BILL_MAX_FILE_SIZE_BYTES);
  assert.ok(UTILITY_BILL_MAX_REQUEST_SIZE_BYTES < 4.5 * 1024 * 1024);
});

test("utility bill MIME validation infers blank browser MIME from safe extensions", () => {
  assert.equal(
    getUtilityBillMimeType("statement.PDF", ""),
    "application/pdf"
  );
  assert.equal(getUtilityBillMimeType("statement.jpg", ""), "image/jpeg");
  assert.equal(getUtilityBillMimeType("statement.png", ""), "image/png");
  assert.equal(getUtilityBillMimeType("statement.exe", ""), null);
  assert.equal(
    getUtilityBillMimeType("statement.pdf", "image/png"),
    "image/png"
  );
  assert.equal(
    getUtilityBillMimeType("statement.pdf", "application/x-utility-bill"),
    null
  );
});

test("blank File.type becomes octet-stream in FormData and remains extension-valid", async () => {
  const sourceFile = new File([Buffer.from("%PDF-")], "statement.pdf", {
    type: "",
  });
  const formData = new FormData();
  formData.append("bill", sourceFile);

  const request = new Request("https://example.test/api/utility-bills", {
    method: "POST",
    body: formData,
  });
  const serializedFile = (await request.formData()).get("bill") as File | null;

  assert.ok(serializedFile);
  assert.equal(serializedFile.type, "application/octet-stream");
  assert.equal(
    getUtilityBillMimeType(serializedFile.name, serializedFile.type),
    "application/pdf"
  );
});

test("utility bill route returns 413 for requests above the shared cap", async () => {
  const { POST } = await import("../src/app/api/utility-bills/route");
  const response = await POST(
    new Request("https://example.test/api/utility-bills", {
      method: "POST",
      headers: {
        "content-length": String(UTILITY_BILL_MAX_REQUEST_SIZE_BYTES + 1),
      },
    })
  );

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    message: UTILITY_BILL_MAX_FILE_SIZE_MESSAGE,
  });
});
