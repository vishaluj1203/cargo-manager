import { describe, expect, it } from "vitest";
import { normalizeSubject, ticketNumber } from "./email";
describe("email domain helpers", () => { it("normalizes reply prefixes", () => expect(normalizeSubject("Re: Fwd: Delay at port")).toBe("Delay at port")); it("formats ticket numbers", () => expect(ticketNumber(42)).toBe("CAR-000042")); });
