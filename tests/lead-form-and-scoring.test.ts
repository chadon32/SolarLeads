import assert from "node:assert/strict";
import test from "node:test";
import {
  getBillRangeByMonthlyBill,
  getMonthlyBillFromRange,
} from "../src/lib/lead-form-values";
import { normalizeAddress, normalizeEmail, normalizePhone } from "../src/lib/lead-normalization";
import { selectLeadForNormalizedProperty } from "../src/lib/lead-deduplication";
import {
  addressesMatch,
  isReasonableMonthlyBill,
  MAX_REASONABLE_MONTHLY_ELECTRIC_BILL,
} from "../src/lib/lead-validation";
import { calculateLeadScore } from "../src/lib/lead-scoring";
import {
  formatPhoneForDisplay,
  formatPhoneForSms,
  isValidUsPhoneNumber,
} from "../src/lib/phone";

test("bill range helpers map form ranges to stable monthly estimates", () => {
  assert.equal(getBillRangeByMonthlyBill(0), "$100-$200");
  assert.equal(getBillRangeByMonthlyBill(99.99), "Under $100");
  assert.equal(getBillRangeByMonthlyBill(150), "$100-$200");
  assert.equal(getBillRangeByMonthlyBill(250), "$200-$300");
  assert.equal(getBillRangeByMonthlyBill(350), "$300-$400");
  assert.equal(getBillRangeByMonthlyBill(401), "$400+");
  assert.equal(getMonthlyBillFromRange("$300-$400"), 350);
  assert.equal(getMonthlyBillFromRange("not a range"), 200);
});

test("monthly bill validation rejects empty, zero, negative, invalid, and extreme values", () => {
  assert.equal(isReasonableMonthlyBill(""), false);
  assert.equal(isReasonableMonthlyBill(0), false);
  assert.equal(isReasonableMonthlyBill(-50), false);
  assert.equal(isReasonableMonthlyBill("not a bill"), false);
  assert.equal(isReasonableMonthlyBill(200.75), true);
  assert.equal(isReasonableMonthlyBill(MAX_REASONABLE_MONTHLY_ELECTRIC_BILL), true);
  assert.equal(isReasonableMonthlyBill(MAX_REASONABLE_MONTHLY_ELECTRIC_BILL + 1), false);
});

test("lead scoring uses exact electric bill buckets instead of upper-bound substring matches", () => {
  const base = {
    completedReportRequest: true,
    email: "owner@example.com",
    ownsHome: "Own",
    panelCount: 18,
    phone: "4805551646",
    preferredContactMethod: "Phone",
    roofAreaM2: 120,
    solarSuitabilityScore: 80,
    solarTimeline: "1-3 months",
    systemSizeKw: 7.2,
    usableRoofAreaM2: 80,
    validResidentialAddress: true,
  };

  const mid = calculateLeadScore({
    ...base,
    electricBillRange: "$200-$300",
    monthlyBill: 250,
  });
  const high = calculateLeadScore({
    ...base,
    electricBillRange: "$300-$400",
    monthlyBill: 350,
  });

  assert.equal(high.score - mid.score, 2);
});

test("phone helpers preserve all digits and format SMS numbers as E.164", () => {
  assert.equal(normalizePhone("4805551646"), "4805551646");
  assert.equal(normalizePhone("(480) 555-1646"), "4805551646");
  assert.equal(formatPhoneForSms("+1 480 555 1646"), "+14805551646");
  assert.equal(formatPhoneForDisplay("4805551646"), "(480) 555-1646");
  assert.equal(isValidUsPhoneNumber("480555164"), false);
});

test("duplicate lead identifiers normalize email, phone, and address consistently", () => {
  assert.equal(normalizeEmail(" Owner@Example.COM "), "owner@example.com");
  assert.equal(normalizePhone("+1 (480) 555-1646"), "4805551646");
  assert.equal(
    normalizeAddress("6420 E. Nance St, Mesa, AZ 85215"),
    normalizeAddress("6420 e nance st mesa az 85215")
  );
  assert.equal(
    addressesMatch("6420 E. Nance St, Mesa, AZ 85215, USA", "6420 e nance st mesa az 85215"),
    true
  );
  assert.equal(
    addressesMatch("6420 E Nance St, Mesa, AZ 85215", "6042 E Nance St, Mesa, AZ 85215"),
    false
  );
});

test("duplicate overwrite selects the matching property across multiple leads", () => {
  const candidates = [
    {
      id: "newest-other-property",
      address: "100 W Main St, Mesa, AZ 85201",
      normalized_address: normalizeAddress("100 W Main St, Mesa, AZ 85201"),
    },
    {
      id: "older-matching-property",
      address: "6420 E Nance St, Mesa, AZ 85215",
      normalized_address: null,
    },
  ];

  assert.equal(
    selectLeadForNormalizedProperty(
      candidates,
      normalizeAddress("6420 E Nance St, Mesa, AZ 85215")
    )?.id,
    "older-matching-property"
  );
  assert.equal(
    selectLeadForNormalizedProperty(
      candidates,
      normalizeAddress("999 W Unknown Ave, Phoenix, AZ 85001")
    ),
    null
  );
});
