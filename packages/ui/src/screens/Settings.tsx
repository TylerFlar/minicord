import { rules as R } from "@minicord/core";
import { Clock } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, GuildIcon } from "../components/Avatar.tsx";
import { STATUS_LABEL } from "../lib/presence.ts";
import { Button, Card, SectionTitle } from "../components/ui.tsx";
import { useNow, useSignals, useStore } from "../app/context.tsx";
import { formatDuration } from "../lib/format.ts";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <div>
        <div className="text-[14px]">{label}</div>
        {hint && <div className="text-[12.5px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Select<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select
      value={String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        const match = options.find((o) => String(o.value) === raw);
        if (match) onChange(match.value);
      }}
      className="rounded-md border border-line bg-bg px-2 py-1 text-[13.5px] outline-none focus:border-accent"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-accent" : "bg-line"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

function ModeSwitch({ mode, onChange }: { mode: R.GuildMode; onChange: (m: R.GuildMode) => void }) {
  return (
    <div className="inline-flex rounded-md border border-line p-0.5 text-[12.5px]">
      {(["open", "vault"] as const).map((m) => (
        <button key={m} onClick={() => onChange(m)} className={`rounded px-2.5 py-0.5 ${mode === m ? "bg-sunken font-medium text-text" : "text-muted"}`}>
          {m === "open" ? "Open" : "Vault"}
        </button>
      ))}
    </div>
  );
}

const hours = (h: number) => ({ value: h, label: h >= 24 ? `${h / 24} day${h > 24 ? "s" : ""}` : `${h} hour${h > 1 ? "s" : ""}` });

export function SettingsScreen() {
  const client = useSignals(["rules", "update"]);
  const store = useStore(["guilds", "me"]);
  const now = useNow(30_000);
  const { config } = client.rules;
  const change = (c: R.Change) => client.requestChange(c);
  const settings = (patch: Extract<R.Change, { kind: "settings" }>["patch"]) => change({ kind: "settings", patch });
  const pendingOf = (kind: R.Change["kind"]) => client.rules.pending.find((p) => p.change.kind === kind);
  const updateHint =
    client.update.state === "downloading"
      ? `Downloading ${client.update.version}…`
      : client.update.state === "checking"
        ? "Checking…"
        : client.update.state === "ready"
          ? `${client.update.version} installs when you restart`
          : undefined;

  const PendingNote = ({ kind }: { kind: R.Change["kind"] }) => {
    const p = pendingOf(kind);
    if (!p) return null;
    return (
      <span className="mr-2 inline-flex items-center gap-1 text-[12px] text-warn">
        <Clock size={11} /> changes in {formatDuration(p.effectiveAt - now)}
        <button className="underline" onClick={() => client.cancelPending(p.id)}>
          cancel
        </button>
      </span>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-surface">
      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="mb-2 text-[22px] font-bold">Settings</h1>
        {store.me && (
          <div className="mb-2 flex items-center gap-3 rounded-lg bg-bg p-3" style={{ ["--avatar-ring" as string]: "var(--mc-bg)" }}>
            <Avatar user={store.me} size={44} status={client.ownStatus() === "invisible" ? "invisible" : client.ownStatus()} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15.5px] font-semibold">{store.me.global_name ?? store.me.username}</div>
              <div className="truncate text-[13px] text-muted">{store.me.username}</div>
            </div>
            <Select
              value={client.ownStatus()}
              options={(["online", "idle", "dnd", "invisible"] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              onChange={(s) => void client.setStatus(s)}
            />
          </div>
        )}

        <SectionTitle>Servers</SectionTitle>
        <Card>
          {store.sortedGuilds().map((g) => {
            const pending = R.pendingFor(client.rules, g.id);
            return (
              <Row key={g.id} label={g.name}>
                <div className="flex items-center gap-2">
                  {pending && (
                    <span className="inline-flex items-center gap-1 text-[12px] text-warn">
                      <Clock size={11} /> opens in {formatDuration(pending.effectiveAt - now)}
                      <button className="underline" onClick={() => client.cancelPending(pending.id)}>
                        cancel
                      </button>
                    </span>
                  )}
                  <GuildIcon guild={g} size={18} muted={R.modeOf(config, g.id) === "vault"} />
                  <ModeSwitch mode={R.modeOf(config, g.id)} onChange={(mode) => change({ kind: "guildMode", guildId: g.id, mode })} />
                </div>
              </Row>
            );
          })}
          <Row label="New servers">
            <PendingNote kind="defaultMode" />
            <ModeSwitch mode={config.defaultMode} onChange={(mode) => change({ kind: "defaultMode", mode })} />
          </Row>
        </Card>

        <SectionTitle>Passes</SectionTitle>
        <Card>
          <Row label="Pass length">
            <PendingNote kind="passMinutes" />
            <Select value={config.passMinutes} options={[5, 10, 15, 20, 30].map((m) => ({ value: m, label: `${m} min` }))} onChange={(value) => change({ kind: "passMinutes", value })} />
          </Row>
          <Row label="One-time extension">
            <PendingNote kind="passExtensionMinutes" />
            <Select value={config.passExtensionMinutes} options={[0, 5, 10].map((m) => ({ value: m, label: m ? `+${m} min` : "None" }))} onChange={(value) => change({ kind: "passExtensionMinutes", value })} />
          </Row>
          <Row label="Pause before a pass">
            <PendingNote kind="passPauseSeconds" />
            <Select
              value={config.passPauseSeconds}
              options={[15, 30, 60, 120, 300, 600].map((s) => ({ value: s, label: s < 60 ? `${s} s` : `${s / 60} min` }))}
              onChange={(value) => change({ kind: "passPauseSeconds", value })}
            />
          </Row>
          <Row label="Pause doubles each time">
            <PendingNote kind="passPauseDoubles" />
            <Toggle checked={config.passPauseDoubles} onChange={(value) => change({ kind: "passPauseDoubles", value })} />
          </Row>
          <Row label="Passes per day">
            <PendingNote kind="manualPassesPerDay" />
            <Select value={config.manualPassesPerDay} options={[0, 1, 2, 3, 5, 10].map((n) => ({ value: n, label: String(n) }))} onChange={(value) => change({ kind: "manualPassesPerDay", value })} />
          </Row>
          <Row label="Delay before loosening a rule">
            <PendingNote kind="cooldownHours" />
            <Select value={config.cooldownHours} options={[1, 6, 12, 24, 48, 72, 168].map(hours)} onChange={(value) => change({ kind: "cooldownHours", value })} />
          </Row>
        </Card>

        <SectionTitle>Notifications</SectionTitle>
        <Card>
          <Row label="Pings from vaulted servers">
            <Select
              value={config.vaultMentionDelivery}
              options={[
                { value: "instant", label: "Right away" },
                { value: "digest", label: "Digest" },
              ]}
              onChange={(vaultMentionDelivery) => settings({ vaultMentionDelivery })}
            />
          </Row>
          <Row label="Digest times">
            <input
              defaultValue={config.digestTimes.join(", ")}
              placeholder="08:00, 18:00"
              onBlur={(e) => {
                const times = e.target.value.split(",").map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t));
                if (times.length) settings({ digestTimes: times });
              }}
              className="w-32 rounded-md border border-line bg-bg px-2 py-1 text-[13.5px] outline-none focus:border-accent"
            />
          </Row>
          <Row label="Ignore @everyone in vaulted servers">
            <Toggle checked={config.vaultIgnoreEveryone} onChange={(vaultIgnoreEveryone) => settings({ vaultIgnoreEveryone })} />
          </Row>
          <Row label="Open servers notify for">
            <Select
              value={config.openNotify}
              options={[
                { value: "mentions", label: "Mentions only" },
                { value: "discord", label: "Discord's setting" },
              ]}
              onChange={(openNotify) => settings({ openNotify })}
            />
          </Row>
          <Row label="Quiet hours">
            <div className="flex items-center gap-2">
              {config.quietHours.enabled && (
                <>
                  <input type="time" value={config.quietHours.start} onChange={(e) => settings({ quietHours: { ...config.quietHours, start: e.target.value } })} className="rounded-md border border-line bg-bg px-1.5 py-0.5 text-[13px]" />
                  <span className="text-muted">–</span>
                  <input type="time" value={config.quietHours.end} onChange={(e) => settings({ quietHours: { ...config.quietHours, end: e.target.value } })} className="rounded-md border border-line bg-bg px-1.5 py-0.5 text-[13px]" />
                </>
              )}
              <Toggle checked={config.quietHours.enabled} onChange={(enabled) => settings({ quietHours: { ...config.quietHours, enabled } })} />
            </div>
          </Row>
        </Card>

        <SectionTitle>About</SectionTitle>
        <Card>
          <Row label={`minicord ${client.appVersion ?? ""}`.trim()} {...(updateHint ? { hint: updateHint } : {})}>
            {client.update.state === "ready" ? (
              <Button tone="accent" size="sm" onClick={() => void client.installUpdate()}>
                Restart to update
              </Button>
            ) : client.update.state === "available" ? (
              <Button tone="accent" size="sm" onClick={() => void client.installUpdate()}>
                Update to {client.update.version}
              </Button>
            ) : (
              <Button size="sm" disabled={client.update.state === "checking" || client.update.state === "downloading"} onClick={() => void client.checkForUpdates()}>
                Check for updates
              </Button>
            )}
          </Row>
        </Card>

        <SectionTitle>Account</SectionTitle>
        <Card>
          <Row label={store.me ? (store.me.global_name ?? store.me.username) : "Signed in"} {...(store.me ? { hint: store.me.username } : {})}>
            <Button tone="danger" size="sm" onClick={() => void client.logout()}>
              Sign out
            </Button>
          </Row>
        </Card>
      </div>
    </div>
  );
}
