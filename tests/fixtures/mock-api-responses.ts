import {
  ONE_PIXEL_PNG_BASE64,
  TEST_ADDRESS,
  TEST_ANALYSIS_PROOF,
  TEST_ROOF_ANALYSIS,
} from "./test-data";

export const autocompleteSuccess = {
  predictions: [
    {
      description: TEST_ADDRESS,
      place_id: "test-place-id",
      structured_formatting: {
        main_text: "1234 Test Solar Way",
        secondary_text: "Mesa, AZ 85201",
      },
      types: ["street_address"],
    },
  ],
};

export const placeDetailsSuccess = {
  formattedAddress: TEST_ADDRESS,
  lat: 33.4152,
  lng: -111.8315,
  types: ["street_address", "premise"],
};

export const satellitePreviewSuccess = {
  formattedAddress: TEST_ADDRESS,
  lat: 33.4152,
  lng: -111.8315,
};

export const roofAnalysisSuccess = {
  analysis: TEST_ROOF_ANALYSIS,
  analysisProof: TEST_ANALYSIS_PROOF,
};

export const satelliteImageSuccess = {
  base64: ONE_PIXEL_PNG_BASE64,
  mimeType: "image/png",
  bounds: TEST_ROOF_ANALYSIS.roofBounds,
};

export const dataLayersSuccess = {
  annualFluxUrl: null,
  dsmUrl: "/__e2e__/test-dsm.tif",
  maskUrl: null,
  rgbUrl: null,
  imageryQuality: "HIGH",
};

export const leadSuccess = {
  lead: {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Test Homeowner",
    email: "test-homeowner@example.test",
    address: TEST_ADDRESS,
    monthlyBill: 250,
    estimatedSavings: 2_108,
    emailDeliveryStatus: "sent",
    quoteRequested: false,
    referralCode: "TESTSAFE",
    reportSummary: {
      annualSavings: 2_108,
      energyOffsetPct: 70,
      monthlySavings: 176,
      panelCount: 20,
      paybackYears: 8.8,
      systemSizeKw: 8,
    },
    reportUrl: "/report/00000000-0000-4000-8000-000000000001?exp=4102444800&token=test",
    updatedExisting: false,
    utilityBillUploaded: false,
  },
};
