import { Anchor, ArrowRight } from "lucide-react";
import { redirect } from "next/navigation";

import { getCurrentWorkspace, requireAuthenticatedUser } from "@/lib/auth";

import { createWorkspace } from "./actions";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAuthenticatedUser();
  if (await getCurrentWorkspace()) redirect("/tickets");
  const query = await searchParams;

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card">
        <div className="brand">
          <span className="brand-mark">
            <Anchor size={18} />
          </span>
          <span>Cargo Manager</span>
        </div>
        <p className="eyebrow" style={{ marginTop: "2rem" }}>
          Workspace setup · Step 1 of 2
        </p>
        <h1>Tell us about your cargo desk.</h1>
        <p>
          We use this to create the right ticket queues and operational
          vocabulary for your team.
        </p>
        {query.error ? (
          <div className="message message-error">{query.error}</div>
        ) : null}

        <form
          action={createWorkspace}
          className="form-grid"
          style={{ marginTop: "1.3rem" }}
        >
          <div className="field span-two">
            <label htmlFor="name">Company or operations team</label>
            <input
              className="input"
              id="name"
              name="name"
              placeholder="North Star Freight Operations"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="companyType">Business type</label>
            <select
              className="select"
              id="companyType"
              name="companyType"
              defaultValue="freight_forwarder"
              required
            >
              <option value="freight_forwarder">Freight forwarder</option>
              <option value="broker">Customs / freight broker</option>
              <option value="operator">Carrier / operator</option>
              <option value="other">Other cargo business</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="timezone">Operating timezone</label>
            <select
              className="select"
              id="timezone"
              name="timezone"
              defaultValue="Asia/Kolkata"
              required
            >
              <option value="Asia/Kolkata">India (Asia/Kolkata)</option>
              <option value="Asia/Dubai">UAE (Asia/Dubai)</option>
              <option value="Asia/Singapore">Singapore</option>
              <option value="Europe/London">United Kingdom</option>
              <option value="Europe/Amsterdam">Central Europe</option>
              <option value="America/New_York">US Eastern</option>
              <option value="America/Los_Angeles">US Pacific</option>
            </select>
          </div>
          <fieldset
            className="field span-two"
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <legend
              style={{
                fontSize: ".83rem",
                fontWeight: 750,
                marginBottom: ".45rem",
              }}
            >
              Transport modes
            </legend>
            <div className="checks">
              {[
                ["air", "Air"],
                ["ocean", "Ocean"],
                ["road", "Road"],
                ["rail", "Rail"],
              ].map(([value, label]) => (
                <label className="check" key={value}>
                  <input
                    type="checkbox"
                    name="modes"
                    value={value}
                    defaultChecked={value === "air" || value === "ocean"}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div
            className="span-two"
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: ".5rem",
            }}
          >
            <button className="button button-primary" type="submit">
              Continue to inbox <ArrowRight size={16} />
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
