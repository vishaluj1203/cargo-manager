import { resolve } from "node:path";

process.loadEnvFile(resolve(import.meta.dirname, "../../../.env.local"));

const { createCargoExtractorFromEnv, createEnquiryClassifierFromEnv } =
  await import("../src/index.js");

const extractor = createCargoExtractorFromEnv();
const classifier = createEnquiryClassifierFromEnv();
const quoteInput = {
  subject: "Air freight quote BOM to FRA",
  sender: "aisha@bluewave-logistics.example",
  receivedAt: new Date("2026-08-21T06:30:00.000Z"),
  latestMessage: `Hello Cargo Desk,

Please quote your best air freight rate from Mumbai to Frankfurt for 12 cartons of machine parts, gross weight 480 kg, dimensions 80 x 60 x 55 cm each.

Cargo will be ready on 24 August 2026. Please include transit time, rate validity and all applicable surcharges.

Regards,
Aisha Khan
BlueWave Logistics`,
};
const classification = await classifier.classify(quoteInput);
if (classification.classification.decision !== "new_quote_enquiry") {
  throw new Error(
    `Live AI classified a freight quote incorrectly: ${classification.classification.decision}`,
  );
}

const nonEnquiry = await classifier.classify({
  subject: "Automated flight status update",
  sender: "notifications@carrier.example",
  receivedAt: new Date("2026-08-21T06:35:00.000Z"),
  latestMessage:
    "Automated notification: flight departure moved by 20 minutes. No reply required.",
});
if (nonEnquiry.classification.decision !== "non_enquiry") {
  throw new Error(
    `Live AI classified an operational notification incorrectly: ${nonEnquiry.classification.decision}`,
  );
}

const result = await extractor.extract(quoteInput);

if (
  result.extraction.origin !== "BOM" &&
  result.extraction.origin !== "Mumbai"
) {
  throw new Error("Live AI smoke test missed the quote origin");
}

console.log(
  JSON.stringify(
    {
      provider: result.provider,
      model: result.model,
      quoteClassification: classification.classification,
      nonEnquiryClassification: nonEnquiry.classification,
      extraction: result.extraction,
      usage: {
        quoteClassification: classification.usage,
        nonEnquiryClassification: nonEnquiry.usage,
        extraction: result.usage,
      },
    },
    null,
    2,
  ),
);
