import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyMention, type MentionContext } from "../src/mentions.ts";
import { decideNotification, type NotifyInput, type RulesConfig } from "../src/rules/index.ts";
import type { Message } from "../src/types.ts";

// The Android service ports this logic to Kotlin and runs these same fixtures
// (apps/android/android/app/src/test/.../FixturesTest.kt).
const load = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));
/** "YYYY-MM-DDTHH:MM" is parsed as local time, matching LocalDateTime on the Kotlin side. */
const local = (s: string) => new Date(s).getTime();

describe("shared fixtures: mentions", () => {
  const f = load("mentions.json");
  for (const c of f.cases) {
    it(c.name, () => {
      const settings = { ...f.context.settings.g, ...(c.settings ?? {}) };
      const ctx: MentionContext = {
        meId: f.context.meId,
        myRoleIds: (guildId) => f.context.roles[guildId] ?? [],
        guildSettings: (guildId) => ({ guild_id: guildId, muted: false, message_notifications: 1, channel_overrides: [], ...settings }),
      };
      expect(classifyMention({ ...f.base, ...c.message } as Message, ctx)).toEqual(c.expect);
    });
  }
});

describe("shared fixtures: notification policy", () => {
  const f = load("notification-policy.json");
  for (const c of f.cases) {
    it(c.name, () => {
      const input = { ...f.base, ...c.input };
      const config: RulesConfig = { ...f.config, ...(c.config ?? {}) };
      const decision = decideNotification({ ...input, config, now: local(input.now) } as NotifyInput);
      if (c.expect.action === "none") {
        expect(decision.action).toBe("none");
      } else {
        expect(decision).toEqual({ ...c.expect, ...(c.expect.until ? { until: local(c.expect.until) } : {}) });
      }
    });
  }
});
