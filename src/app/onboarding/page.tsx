"use client";

import { useState } from "react";

const methods = [
  { id: "forward", icon: "↗", title: "Forwarding address", text: "Fastest pilot. Forward a copy of cargo emails to a unique address." },
  { id: "google", icon: "G", title: "Google Workspace", text: "Connect a shared Gmail inbox with secure Google OAuth." },
  { id: "microsoft", icon: "⊞", title: "Microsoft 365", text: "Connect an Outlook shared mailbox with Microsoft OAuth." },
  { id: "demo", icon: "✦", title: "Explore with demo data", text: "See the workflow with realistic cargo tickets before connecting email." }
];

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [workspace, setWorkspace] = useState("Acme Logistics");
  const [method, setMethod] = useState("forward");
  const address = `inbox+${workspace.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}@inbound.cargomanager.app`;
  const next = () => setStep((current) => Math.min(4, current + 1));

  return <main className="onboarding"><div className="onboard-top"><a className="brand" href="/"><span className="mark">✦</span><span>Cargo Manager</span></a><span className="muted small">Workspace setup · {step} of 4</span></div><div className="progress"><span style={{ width: `${step * 25}%` }} /></div><section className="onboard-card">
    {step === 1 && <><p className="eyebrow">WELCOME TO CARGO MANAGER</p><h1>Set up your operations workspace.</h1><p className="muted intro">This is where your team will triage cargo requests, collaborate, and reply to customers.</p><label>Company or team name<input value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="Acme Logistics" /></label><label>Your work email<input defaultValue="ops@acme-logistics.com" type="email" /></label><button className="primary wide" onClick={next}>Create workspace <span>→</span></button><p className="fine">You can change these details later. No inbox access is requested yet.</p></>}
    {step === 2 && <><p className="eyebrow">CONNECT AN INBOX</p><h1>How should cargo emails arrive?</h1><p className="muted intro">Start with forwarding for the quickest pilot. OAuth is best when you want to connect a shared mailbox directly.</p><div className="method-grid">{methods.map((item) => <button className={`method ${method === item.id ? "selected" : ""}`} onClick={() => setMethod(item.id)} key={item.id}><span className="method-icon">{item.icon}</span><span><strong>{item.title}</strong><small>{item.text}</small></span>{method === item.id && <b className="check">✓</b>}</button>)}</div><button className="primary wide" onClick={next}>{method === "demo" ? "Load demo workspace" : "Continue with this setup"} <span>→</span></button><button className="back" onClick={() => setStep(1)}>← Back</button></>}
    {step === 3 && <><p className="eyebrow">INBOX VERIFICATION</p><h1>Forward cargo email to this address.</h1><p className="muted intro">Ask your mail administrator to create a forwarding rule for the shared cargo inbox. We will verify it when the first message arrives.</p><div className="address-box"><span>{method === "demo" ? "Demo inbox ready" : address}</span><button onClick={() => navigator.clipboard?.writeText(address)}>Copy</button></div>{method !== "demo" && <div className="instructions"><div><b>1</b><span>Create a forwarding rule in your mailbox.</span></div><div><b>2</b><span>Forward only cargo support messages during the pilot.</span></div><div><b>3</b><span>Send a test email with an AWB or container number.</span></div></div>}<button className="primary wide" onClick={next}>{method === "demo" ? "Open demo tickets" : "I’ve configured forwarding"} <span>→</span></button><button className="back" onClick={() => setStep(2)}>← Back</button></>}
    {step === 4 && <><div className="success-icon">✓</div><p className="eyebrow">YOU’RE READY</p><h1>{method === "demo" ? "Your demo workspace is ready." : "Your inbox setup is ready."}</h1><p className="muted intro">Cargo Manager will parse each message, create a ticket, and keep replies in the same conversation thread.</p><div className="ready-list"><div><span>✓</span><strong>AI email parsing</strong><small>Extracts shipment references, urgency, route, and requested action.</small></div><div><span>✓</span><strong>Ticket workflow</strong><small>Assign, prioritize, resolve, and audit every request.</small></div><div><span>✓</span><strong>Safe replies</strong><small>Replies are queued and sent through your configured email provider.</small></div></div><a className="primary wide cta" href="/">Open operations desk <span>→</span></a><p className="fine">Invite teammates and connect a production mailbox from Settings.</p></>}
  </section><p className="onboard-help">Need help? <a href="mailto:support@cargomanager.app">Talk to our team</a></p></main>;
}
