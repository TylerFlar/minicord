import { useState } from "react";
import { Button } from "../components/ui.tsx";
import { useClient } from "../app/context.tsx";

export function LoginScreen() {
  const client = useClient();
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  const run = async (withToken?: string) => {
    setBusy(true);
    setError("");
    const ok = await client.login(withToken).catch(() => false);
    setBusy(false);
    if (!ok) setError(withToken ? "That token didn't work." : "Sign-in was cancelled.");
  };

  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-semibold tracking-tight">minicord</h1>
        <p className="mt-1 text-[15px] text-muted">Discord, minus the scroll.</p>
        <Button tone="accent" className="mt-8 w-full justify-center py-2" disabled={busy} onClick={() => void run()}>
          {busy ? "Waiting for Discord…" : "Sign in with Discord"}
        </Button>
        {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
        <button className="mt-6 text-[13px] text-muted underline" onClick={() => setShowToken((s) => !s)}>
          Use a token instead
        </button>
        {showToken && (
          <div className="mt-2 flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Token"
              className="flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:border-accent"
            />
            <Button disabled={!token.trim() || busy} onClick={() => void run(token.trim())}>
              Save
            </Button>
          </div>
        )}
        <p className="mt-10 text-[11.5px] leading-relaxed text-faint">Unofficial client. Third-party clients break Discord's Terms; use at your own risk.</p>
      </div>
    </div>
  );
}
