import { resolve } from "node:path";

process.loadEnvFile(resolve(import.meta.dirname, "../../../.env.local"));

const { createCargoExtractorFromEnv } = await import("../src/index.js");

const extractor = createCargoExtractorFromEnv();
const result = await extractor.extract({
  subject: "URGENT: Customs hold on MAWB 176-12345675",
  sender: "aisha@bluewave-logistics.example",
  receivedAt: new Date("2026-08-16T06:30:00.000Z"),
  latestMessage: `Hello Cargo Desk,

Our air shipment under MAWB 176-12345675 and HAWB BW-90023 from Mumbai to Frankfurt is held by customs because the commercial invoice is missing.

The document cutoff is tomorrow, 17 August 2026 at 14:00 IST. Please send the invoice to customs and confirm release before cutoff to prevent storage charges.

Regards,
Aisha Khan
BlueWave Logistics`,
});

if (
  !result.extraction.shipmentReferences.some(
    (reference) => reference.value === "176-12345675",
  )
) {
  throw new Error("Live AI smoke test missed the MAWB shipment reference");
}

console.log(
  JSON.stringify(
    {
      provider: result.provider,
      model: result.model,
      extraction: result.extraction,
      usage: result.usage,
    },
    null,
    2,
  ),
);
