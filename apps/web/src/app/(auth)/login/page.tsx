import { Anchor, ArrowRight, CheckCircle2 } from "lucide-react";

import { signIn, signUp } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; mode?: string }>;
}) {
  const query = await searchParams;
  const isSignUp = query.mode === "signup";

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="brand">
          <span className="brand-mark">
            <Anchor size={18} />
          </span>
          <span>Cargo Manager</span>
        </div>
        <div className="auth-copy">
          <p className="eyebrow">Built for cargo operations</p>
          <h1>Every email becomes accountable work.</h1>
          <p>
            One operational inbox for freight forwarders, brokers and
            operators—AI-triaged, threaded and visible from first request to
            final reply.
          </p>
        </div>
        <div className="auth-proof">
          <span>
            <CheckCircle2 size={14} /> Email-native workflow
          </span>
          <span>
            <CheckCircle2 size={14} /> Human-reviewed AI
          </span>
          <span>
            <CheckCircle2 size={14} /> Complete audit trail
          </span>
        </div>
      </section>

      <section className="auth-main">
        <div className="auth-card">
          <p className="eyebrow">Skyvalence</p>
          <h2>{isSignUp ? "Create your workspace" : "Welcome back"}</h2>
          <p>
            {isSignUp
              ? "Start with a secure account. Your cargo desk comes next."
              : "Sign in to your cargo operations desk."}
          </p>

          {query.error ? (
            <div className="message message-error">{query.error}</div>
          ) : null}
          {query.message ? (
            <div className="message message-success">{query.message}</div>
          ) : null}

          <form
            action={isSignUp ? signUp : signIn}
            className="form-stack"
            style={{ marginTop: "1rem" }}
          >
            {isSignUp ? (
              <div className="field">
                <label htmlFor="fullName">Your name</label>
                <input
                  className="input"
                  id="fullName"
                  name="fullName"
                  autoComplete="name"
                  required
                />
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="email">Work email</label>
              <input
                className="input"
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                className="input"
                id="password"
                name="password"
                type="password"
                minLength={8}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                required
              />
            </div>
            <button className="button button-primary" type="submit">
              {isSignUp ? "Create account" : "Sign in"} <ArrowRight size={16} />
            </button>
          </form>

          <p
            className="form-hint"
            style={{ marginTop: "1.2rem", textAlign: "center" }}
          >
            {isSignUp ? "Already have an account? " : "New to Cargo Manager? "}
            <a
              href={isSignUp ? "/login" : "/login?mode=signup"}
              style={{ color: "var(--brand)", fontWeight: 750 }}
            >
              {isSignUp ? "Sign in" : "Create one"}
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
