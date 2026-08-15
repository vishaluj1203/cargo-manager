# Cargo email location-code research

Status: validated research; schema changes proposed but not implemented

Recorded: 2026-08-16

## Purpose

Determine whether freight forwarders, brokers, operators and their customers are likely to identify shipment routes using codes instead of full location names, and assess whether Cargo Manager's current AI extraction contract handles those messages safely.

## Conclusion

Code-only and shorthand routing is normal cargo communication, not an edge case.

- Air cargo commonly uses three-character IATA airport or city codes.
- Ocean and multimodal cargo commonly uses five-character UN/LOCODEs.
- Road requests may identify locations using postal codes, depot codes or customer-specific facility codes.
- A message can contain several route roles: place of receipt, origin airport, port of loading, transshipment point, port of discharge and final destination.
- Cargo Manager's current flat `origin` and `destination` strings preserve simple code pairs but cannot represent or independently validate a multi-leg route.

The AI should identify the meaning and role of each code. A reference-data layer should validate and enrich the extracted code without replacing the AI with a regex parser.

## Evidence from public standards and carrier workflows

### Air cargo

IATA maintains three-character identifiers for airports, metropolitan areas and certain intermodal locations. These identifiers are used in cargo documentation and operational systems.

IATA's e-AWB handling guidance makes the origin and destination airport codes mandatory. Its compact examples include an AWB followed directly by origin and destination codes, piece count and weight, as well as routing segments such as `RTG/SINSQ/BNESQ`.

Sources:

- [IATA e-AWB handling guidelines](https://www.iata.org/contentassets/b559d10aeb734d5196332b4953dcf312/e-awb-handling-guidelines-sg.pdf)
- [IATA Airport and Location Identifier Database](https://www.iata.org/en/publications/manuals/airline-airport-location-coding-databases/airport-location-identifier-database/)
- [IATA airline and location codes](https://www.iata.org/en/services/codes/)

### Ocean and multimodal cargo

UN/LOCODE is a five-character geographic code: a two-character ISO country code followed by a three-character location code. UNECE states that the codes are used as an alternative to full names for ports, airports, inland terminals, places of receipt and delivery, and other trade locations. It is widely used by shipping companies and freight forwarders.

Carrier booking guidance expects route roles rather than only a general origin and destination. CMA CGM lists POL, POD and final destination as booking information. Maersk requests origin, destination, service mode, commodity, equipment and departure date.

Sources:

- [UNECE Recommendation 16: UN/LOCODE](https://unlocode.unece.org/recommendation16/)
- [Official UN/LOCODE publications](https://unlocode.unece.org/publications/)
- [CMA CGM mandatory booking information](https://www.cma-cgm.com/assets/public/documents/Informations%20obligatoires%20dans%20les%20demandes%20de%20booking%20%20V2%20GB.pdf?VersionId=BvOcaf1MAA569TWpgvUIV0jaK1gdWeM0)
- [Maersk freight booking guide](https://www.maersk.com/news/articles/2024/03/05/maersk-spot-booking)

### Email booking workflows

Alaska Air Cargo provides a public email booking workflow whose routing field is entered as origin-to-destination. It separately asks for ship date, pieces, weight, dimensions, commodity, consignee and supporting documents. This supports treating terse route codes as one part of a larger extraction rather than assuming that full location names will be supplied.

Source: [Alaska Air Cargo email booking request](https://www.alaskacargo.com/email-booking-request)

## Representative messages

These are synthetic messages derived from the public formats above. They are not customer emails.

### Air-freight RFQ

```text
Subject: RFQ BOM-FRA / 5 pcs / 420 kg / CRD 19AUG

Pls quote BOM-FRA.
5 pcs, 120x80x90 cm each, GW 420 kg.
Non-DG, stackable. CRD 19 Aug.
Need all-in and transit.
```

### Ocean booking request

```text
Subject: BK REQ CNSHA-NLRTM 1x40HC

POL CNSHA / POD NLRTM / FND DEHAM
1x40HC, auto parts, 18,500 KGS, CY/CY, non-haz.
CRD 22 Aug. Pls book earliest sailing.
```

### Compact air-status request

```text
Subject: Status 618-37257861 AMS-BNE

618-37257861 AMSBNE / T9 K510.0
FLT SQ323/29 / RTG SINSQ BNESQ
pls confirm uplift and ETA
```

Other likely variations must be included in the future corpus:

- `MAA > DXB`, `MAA/DXB`, `MAA-DXB` and `ex MAA to DXB`
- UN/LOCODE with and without a separator, such as `CN SHA` and `CNSHA`
- mixed city names and codes, such as `Chennai-DXB`
- road postal-code lanes
- depot, terminal and customer facility codes
- multiple transshipment points
- route data present only in the subject line or an attachment

## Live Gemma experiment

All three representative messages were submitted to the configured production extractor using the real Google Gemini API and `gemma-4-26b-a4b-it`. Each response reported provider `google-gemini-api` and non-zero token usage.

### Air RFQ result

- Preserved `BOM` as origin and `FRA` as destination.
- Classified the request as `booking` with normal priority.
- Extracted pieces, weight and cargo handling facts into its summary and requested action.
- Used 745 input tokens and 179 output tokens.

### Ocean booking result

- Preserved `CNSHA` as origin and `NLRTM` as destination.
- Classified the request as `booking`.
- Lost final destination `DEHAM` because the schema has no final-destination field.
- Incorrectly inferred a company from the synthetic sender domain.
- Incorrectly marked some supplied equipment, commodity and weight details as missing.
- Returned an overall confidence of only `0.1` despite correctly identifying the main route and request.
- Used 740 input tokens and 178 output tokens.

### Compact air-status result

- Interpreted `AMS` and `BNE` as the route.
- Classified the request as `shipment_status`.
- Extracted the request to confirm uplift and ETA.
- Classified `618-37257861` as `other` instead of an AWB.
- Inferred a customer and company name from the sender domain, which is not acceptable evidence.
- Used 734 input tokens and 197 output tokens.

## Confirmed gaps

1. Flat `origin` and `destination` fields cannot represent route roles or multiple legs.
2. The model may expand a code from model knowledge without proving that the mapping is current or contextually correct.
3. A three-character token can be ambiguous without mode and surrounding labels.
4. Final destination, place of receipt, transshipment and delivery locations can be lost.
5. The current shipment-reference enum is too narrow for MAWB, HAWB, flight, vessel, voyage, quote and carrier-booking references.
6. Overall confidence hides field-level uncertainty.
7. Sender-domain text must not be treated as evidence of a company or person's name.
8. The current schema does not separately retain equipment, package, weight, volume, dimensions, Incoterm, service mode, cargo-ready date, ETD, ETA or cutoff.

## Proposed route contract

The exact contract requires an implementation decision, but the target shape should preserve raw evidence and validation state:

```json
{
  "mode": "ocean",
  "locations": [
    {
      "role": "port_of_loading",
      "raw": "CNSHA",
      "code": "CNSHA",
      "codeSystem": "unlocode",
      "resolvedName": "Shanghai",
      "countryCode": "CN",
      "resolutionStatus": "validated",
      "evidence": "POL CNSHA",
      "confidence": 0.99
    },
    {
      "role": "port_of_discharge",
      "raw": "NLRTM",
      "code": "NLRTM",
      "codeSystem": "unlocode",
      "resolvedName": "Rotterdam",
      "countryCode": "NL",
      "resolutionStatus": "validated",
      "evidence": "POD NLRTM",
      "confidence": 0.99
    },
    {
      "role": "final_destination",
      "raw": "DEHAM",
      "code": "DEHAM",
      "codeSystem": "unlocode",
      "resolvedName": "Hamburg",
      "countryCode": "DE",
      "resolutionStatus": "validated",
      "evidence": "FND DEHAM",
      "confidence": 0.99
    }
  ]
}
```

Candidate location roles:

- `place_of_receipt`
- `origin`
- `origin_airport`
- `port_of_loading`
- `transshipment`
- `destination_airport`
- `port_of_discharge`
- `final_destination`
- `place_of_delivery`
- `pickup`
- `delivery`
- `unknown`

Candidate code systems:

- `iata`
- `icao`
- `unlocode`
- `postal`
- `terminal`
- `customer_facility`
- `unknown`

## Validation and enrichment strategy

1. AI extracts the raw token, its semantic role, likely code system, mode, evidence and confidence.
2. The application retains the raw token even when lookup fails.
3. A deterministic reference lookup validates the candidate and adds canonical names and country codes.
4. Ambiguous or missing matches remain unresolved and send the ticket to `needs_verification`.
5. The lookup must never silently replace a code with the model's remembered location name.
6. Extraction confidence and reference-resolution confidence must be stored separately.

This remains AI-based parsing. Reference lookup is validation and enrichment, not regex-based extraction.

## Reference-data options

### Ports and multimodal locations

Use the official UN/LOCODE production release. It is downloadable and appropriate for local PostgreSQL import. Record the source release version and import date.

Source: [UN/LOCODE publications](https://unlocode.unece.org/publications/)

### Airports during the demo phase

OurAirports publishes nightly CSV files in the public domain and includes airport code fields. It explicitly provides no accuracy guarantee, so records derived from it must identify the source and should not be represented as authoritative.

Source: [OurAirports open data](https://ourairports.com/data/)

### Airports in production

Use a properly licensed authoritative IATA source when commercial accuracy and support are required. IATA's official Airport and Location Identifier Database is a subscription product and is updated daily.

Source: [IATA Airport and Location Identifier Database](https://www.iata.org/en/publications/manuals/airline-airport-location-coding-databases/airport-location-identifier-database/)

## Required extraction expansion

Alongside structured route locations, the next contract should evaluate:

- transport mode and service type
- equipment quantity, size and type
- package count and package type
- gross weight, chargeable weight, volume and dimensions with units
- commodity, HS code, dangerous-goods state, UN number and handling requirements
- Incoterm and prepaid/collect responsibility
- cargo-ready date, pickup date, cutoff, ETD, ETA and required-delivery date
- AWB, MAWB, HAWB, bill of lading, booking, container, quote, flight, vessel and voyage references
- explicit parties without inferring identities from domains
- missing information tied to a specific workflow
- confidence and evidence per extracted field

## Acceptance criteria for implementation

- Preserve every route code exactly as received.
- Extract all stated route roles, including final destination and transshipment points.
- Never infer a person or company solely from an email domain.
- Validate recognized codes against a versioned reference dataset.
- Never convert an unresolved code into a guessed canonical name.
- Route ambiguous codes to `needs_verification`.
- Correctly distinguish AWB, MAWB and HAWB references in compact messages.
- Do not mark an explicitly supplied cargo field as missing.
- Store raw evidence and field-level confidence.
- Pass a versioned corpus covering air, ocean, road and multimodal shorthand.
- Continue failing closed when hosted AI or schema validation fails.

## Recommended next step

Before adding more ticket features, design and migrate the extraction contract around structured locations, cargo details, route dates and expanded references. Then assemble a code-heavy synthetic regression corpus grounded in the public standards above and run it against both mocked contract tests and live Gemma evaluation.
