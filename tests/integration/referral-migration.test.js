import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../database/migrations/030_secure_referrals.sql", import.meta.url);
const hardeningMigrationUrl = new URL("../../database/migrations/031_harden_referral_identity_and_qualification.sql", import.meta.url);

describe("secure referral migration", () => {
  it("keeps all referral tables service-role only", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    for (const table of [
      "referral_codes",
      "referrals",
      "referral_rewards",
      "successful_project_events",
      "user_activity_summary",
      "referral_risk_signals",
      "referral_click_daily",
    ]) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.referral_codes[\s\S]+FROM PUBLIC, authenticated, anon/);
  });

  it("contains the atomic grant, hold, cap, trigger, and idempotency guards", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("bind_referral_and_grant_trial");
    expect(sql).toContain("settle_referral_reward");
    expect(sql).toContain("interval '72 hours'");
    expect(sql).toContain("monthly_rewards >= 5");
    expect(sql).toContain("projects_capture_referral_success");
    expect(sql).toContain("UNIQUE (referral_id, reward_type)");
    expect(sql).toContain("credit_logs_reference_unique");
    expect(sql).toContain("pg_advisory_xact_lock");
  });

  it("provides the Supabase audit and aggregate views", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("admin_referral_overview");
    expect(sql).toContain("admin_referral_metrics");
    expect(sql).toContain("risk_flags");
    expect(sql).toContain("rejection_reason");
  });

  it("hardens alias identity and successful-project qualification", async () => {
    const sql = await readFile(hardeningMigrationUrl, "utf8");
    expect(sql).toContain("canonical_referral_email");
    expect(sql).toContain("self_referral_alias");
    expect(sql).toContain("COALESCE(NEW.credit_deducted, false) = false");
    expect(sql).toContain("NULLIF(btrim(NEW.svg_url), '')");
    expect(sql).toContain("UPDATE OF generated_image_url, upscaled_image_url, svg_url, refunded, credit_deducted");
    expect(sql).toMatch(/SECURITY DEFINER SET search_path = public/);
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTION public.canonical_referral_email(text)");
  });
});
