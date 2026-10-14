import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { useCustomPricingStore } from "@multica/core/runtimes/custom-pricing-store";
import type { RuntimeUsage } from "@multica/core/types";

import {
  addDaysIso,
  aggregateByWeek,
  estimateCost,
  estimateCostBreakdown,
  formatTokens,
  summarizeTaskUsage,
  summarizeTaskUsageAcross,
  todayIso,
  weekStartIso,
} from "./utils";

afterEach(() => {
  // Reset overrides so tests don't bleed pricing state into one another.
  useCustomPricingStore.setState({ pricings: {} });
});

const zeroUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
};

describe("estimateCost", () => {
  it("prices the canonical Anthropic Sonnet 4.6 SKU", () => {
    const cost = estimateCost({
      ...zeroUsage,
      model: "claude-sonnet-4-6",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    // 1M × $3 input + 1M × $15 output = $18.
    expect(cost).toBeCloseTo(18, 5);
  });

  it("prices a Codex CLI session reporting gpt-5-codex", () => {
    const cost = estimateCost({
      ...zeroUsage,
      model: "gpt-5-codex",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 2_000_000,
    });
    // 1M × $1.25 + 1M × $10 + 2M × $0.125 = $11.50.
    expect(cost).toBeCloseTo(11.5, 5);
  });

  it("strips dated snapshots before resolving (gpt-5-2025-08-07 → gpt-5)", () => {
    const cost = estimateCost({
      ...zeroUsage,
      model: "gpt-5-2025-08-07",
      input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(1.25, 5);
  });

  it("prices a Copilot session reporting claude-opus-4.7 at the official Opus rate", () => {
    // Copilot's `meta.agentMeta.model` is `claude-opus-4.7` (dotted). We
    // canonicalize to the dashed catalog key so it hits the maintained $5/$25
    // tier instead of falling through to the custom-pricing dialog.
    const cost = estimateCost({
      ...zeroUsage,
      model: "claude-opus-4.7",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(5 + 25, 5);
  });

  it("prices Claude Fable 5 at the Mythos-class tier", () => {
    const cost = estimateCost({
      ...zeroUsage,
      model: "claude-fable-5",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 1_000_000,
      cache_write_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(10 + 50 + 1 + 12.5, 5);
  });

  it("prices Claude Fable 5.1 at the Mythos-class tier with quarter-rate cache reads", () => {
    // Same $10 / $50 and $12.50 cache write as Fable 5, but cache reads are
    // 0.025x input ($0.25) rather than the usual 0.1x.
    const cost = estimateCost({
      ...zeroUsage,
      model: "claude-fable-5-1",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 1_000_000,
      cache_write_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(10 + 50 + 0.25 + 12.5, 5);
  });

  it("prices Claude Sonnet 5 at Anthropic's intro $2 / $10 tier", () => {
    const cost = estimateCost({
      ...zeroUsage,
      model: "claude-sonnet-5",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 1_000_000,
      cache_write_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(2 + 10 + 0.2 + 2.5, 5);
  });

  it("prices the provider-prefixed Anthropic form (anthropic/claude-sonnet-4.6)", () => {
    // openclaw / opencode emit `<provider>/<model>`. Same SKU as the
    // bare form, must hit the same rate.
    const cost = estimateCost({
      ...zeroUsage,
      model: "anthropic/claude-sonnet-4.6",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3 + 15, 5);
  });

  it("prices the dated dotted Anthropic form (claude-haiku-4.5-20251001)", () => {
    // Belt-and-braces: combine all three tolerances (provider prefix not
    // present, but dot→dash + date strip both apply).
    const cost = estimateCost({
      ...zeroUsage,
      model: "claude-haiku-4.5-20251001",
      input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(1, 5);
  });

  it("prices the full provider+dotted+dated form (anthropic/claude-opus-4.7-20251001)", () => {
    // All three normalization steps must compose: strip `anthropic/`,
    // dot→dash on the Claude ID, and trim the date stamp. Pins the
    // combined path so a future change to candidate ordering can't
    // silently drop one tolerance.
    const cost = estimateCost({
      ...zeroUsage,
      model: "anthropic/claude-opus-4.7-20251001",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(5 + 25, 5);
  });

  it("prices each dotted Codex catalog SKU at its own tier, not gpt-5", () => {
    // Every dotted minor version is priced independently. The resolver does
    // exact-match-after-date-strip (no startsWith fallback), so each row
    // must exist on its own.
    expect(
      estimateCost({ ...zeroUsage, model: "gpt-5.5", input_tokens: 1_000_000 }),
    ).toBeCloseTo(5, 5);
    expect(
      estimateCost({ ...zeroUsage, model: "gpt-5.4", output_tokens: 1_000_000 }),
    ).toBeCloseTo(15, 5);
    expect(
      estimateCost({
        ...zeroUsage,
        model: "gpt-5.4-mini",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      }),
    ).toBeCloseTo(0.75 + 4.5, 5);
    expect(
      estimateCost({
        ...zeroUsage,
        model: "gpt-5.3-codex",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      }),
    ).toBeCloseTo(1.75 + 14, 5);
  });

  it("prices current Codex models per OpenAI's official cache-aware rates", () => {
    // Official announcement rates. 5.6 is the first OpenAI generation to bill
    // cache writes separately: cacheRead generally = 0.1x input (GPT-6.1
    // Sol uses 0.05x), cacheWrite = 1.25x
    // input. Cover every model x every token category so a wrong cache rate
    // can't hide behind an input-only assertion. `total` is 1M of each of the
    // four categories priced at its own rate.
    const cases = [
      { model: "gpt-6-astra", input: 10, cacheRead: 1, cacheWrite: 12.5, output: 50, total: 73.5 },
      { model: "gpt-6.1-sol", input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10, total: 14.6 },
      { model: "gpt-6-sol", input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10, total: 14.7 },
      { model: "gpt-6-luna", input: 0.1, cacheRead: 0.01, cacheWrite: 0.125, output: 0.5, total: 0.735 },
      { model: "gpt-5.6-sol", input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 30, total: 41.75 },
      { model: "gpt-5.6-terra", input: 2.5, cacheRead: 0.25, cacheWrite: 3.125, output: 15, total: 20.875 },
      { model: "gpt-5.6-luna", input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 6, total: 8.35 },
    ];
    for (const c of cases) {
      const breakdown = estimateCostBreakdown({
        ...zeroUsage,
        model: c.model,
        input_tokens: 1_000_000,
        cache_read_tokens: 1_000_000,
        cache_write_tokens: 1_000_000,
        output_tokens: 1_000_000,
      });
      expect(breakdown.input).toBeCloseTo(c.input, 5);
      expect(breakdown.cacheRead).toBeCloseTo(c.cacheRead, 5);
      expect(breakdown.cacheWrite).toBeCloseTo(c.cacheWrite, 5);
      expect(breakdown.output).toBeCloseTo(c.output, 5);
      expect(
        estimateCost({
          ...zeroUsage,
          model: c.model,
          input_tokens: 1_000_000,
          cache_read_tokens: 1_000_000,
          cache_write_tokens: 1_000_000,
          output_tokens: 1_000_000,
        }),
      ).toBeCloseTo(c.total, 5);
    }
  });

  it("keeps subscription-only and preview SKUs distinct from their GA siblings", () => {
    // qwen3.8-max-preview is subscription-priced at 0; it must NOT inherit
    // qwen3.8-max's $2/$6 tier, and `qwen3.8-max-preview[1m]` must resolve
    // to the preview row after the context-tag strip.
    expect(
      estimateCost({
        ...zeroUsage,
        model: "qwen3.8-max-preview[1m]",
        input_tokens: 1_000_000,
      }),
    ).toBe(0);
    expect(
      estimateCost({
        ...zeroUsage,
        model: "qwen3.8-max",
        input_tokens: 1_000_000,
      }),
    ).toBeCloseTo(2, 5);
  });

  it("returns 0 for a genuinely unknown model so the UI can flag it", () => {
    expect(
      estimateCost({
        ...zeroUsage,
        model: "totally-made-up-model",
        input_tokens: 1_000_000,
      }),
    ).toBe(0);
  });

  it("prices Cursor Composer rows at the published rates without cache-write spend", () => {
    // Cursor's ids are unprefixed generic names, so they're provider-qualified
    // (`cursor/auto`) and only resolve when the row carries provider "cursor".
    const costWithAllTokenTypes = (model: string) =>
      estimateCost({
        ...zeroUsage,
        provider: "cursor",
        model,
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_read_tokens: 1_000_000,
        cache_write_tokens: 1_000_000,
      });

    expect(costWithAllTokenTypes("auto")).toBeCloseTo(1.25 + 6 + 0.25, 5);
    expect(costWithAllTokenTypes("composer-2.5-fast")).toBeCloseTo(
      3 + 15 + 0.5,
      5,
    );
    expect(costWithAllTokenTypes("composer-2.5")).toBeCloseTo(0.5 + 2.5 + 0.2, 5);
    expect(costWithAllTokenTypes("composer-2-fast")).toBeCloseTo(
      1.5 + 7.5 + 0.35,
      5,
    );
    expect(costWithAllTokenTypes("composer-2")).toBeCloseTo(0.5 + 2.5 + 0.2, 5);
    expect(costWithAllTokenTypes("composer-1.5")).toBeCloseTo(
      3.5 + 17.5 + 0.35,
      5,
    );
    expect(costWithAllTokenTypes("composer-1")).toBeCloseTo(
      1.25 + 10 + 0.125,
      5,
    );
    // The legacy `cursor` fallback equals the provider name, so it stays
    // unqualified and resolves regardless of the row's provider.
    expect(costWithAllTokenTypes("cursor")).toBeCloseTo(3 + 15 + 0.5, 5);
  });

  it("scopes the generic `auto` id by provider so collisions don't borrow a price", () => {
    const auto = (provider?: string) =>
      estimateCost({ ...zeroUsage, provider, model: "auto", input_tokens: 1_000_000 });

    // Cursor's `auto` is priced via the `cursor/auto` row.
    expect(auto("cursor")).toBeCloseTo(1.25, 5);
    // A different provider reporting `auto` has no row
    // yet — it must NOT inherit Cursor's price; it stays unmapped ($0).
    expect(auto("acme")).toBe(0);
    // No provider at all → also unmapped, never silently Cursor's price.
    expect(auto(undefined)).toBe(0);
  });

  // The Chinese-model rates below are spot-checked against the literal
  // numbers on the three official price sheets cited in MODEL_PRICING's
  // header comment. Pinning them in tests is what catches a future edit
  // that copies a price from a near-named neighbour by accident — the
  // mistake the previous attempt (PR #3170, closed) made.
  it("prices deepseek-v4-flash at the official $0.14/$0.28 with ~50× cache-hit discount", () => {
    // 1M input × $0.14 + 1M output × $0.28 + 1M cache read × $0.0028 = $0.4228.
    const cost = estimateCost({
      ...zeroUsage,
      model: "deepseek-v4-flash",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.14 + 0.28 + 0.0028, 5);
  });

  it("prices the deepseek-chat / deepseek-reasoner aliases at the same rate as deepseek-v4-flash", () => {
    // The DeepSeek docs explicitly route both legacy names to v4-flash —
    // they must hit the same numbers, not the older $0.27/$1.10 tier.
    const flash = estimateCost({
      ...zeroUsage,
      model: "deepseek-v4-flash",
      input_tokens: 1_000_000,
    });
    expect(
      estimateCost({
        ...zeroUsage,
        model: "deepseek-chat",
        input_tokens: 1_000_000,
      }),
    ).toBeCloseTo(flash, 5);
    expect(
      estimateCost({
        ...zeroUsage,
        model: "deepseek-reasoner",
        input_tokens: 1_000_000,
      }),
    ).toBeCloseTo(flash, 5);
  });

  it("prices kimi-k2.6 at the official $0.95 / $4.00 tier (not the K2 tier)", () => {
    // Moonshot's K2.6 page is the only authoritative source today; K2.6 is
    // explicitly NOT priced like K2. 1M input × $0.95 + 1M output × $4.00 = $4.95.
    expect(
      estimateCost({
        ...zeroUsage,
        model: "kimi-k2.6",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      }),
    ).toBeCloseTo(4.95, 5);
  });

  it("prices glm-5.1 at the official $1.4 / $4.4 tier", () => {
    expect(
      estimateCost({
        ...zeroUsage,
        model: "glm-5.1",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      }),
    ).toBeCloseTo(1.4 + 4.4, 5);
  });

  it("prices grok-4.5 at xAI's short-context $2.00 / $6.00 tier", () => {
    // 1M input × $2.00 + 1M output × $6.00 + 1M cached-read × $0.30.
    // Short context on purpose: the long-context (≥200K prompt) tier is 2x,
    // but aggregated rows carry no per-request prompt sizes.
    expect(
      estimateCost({
        ...zeroUsage,
        provider: "xai",
        model: "grok-4.5",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_read_tokens: 1_000_000,
      }),
    ).toBeCloseTo(8.3, 5);
  });

  it("prices grok-4.6 at xAI's short-context $2.00 / $6.00 tier with $0.50 cached input", () => {
    // grok-4.6 cached input is $0.50/1M, not grok-4.5's $0.30.
    // 1M input × $2.00 + 1M output × $6.00 + 1M cached-read × $0.50.
    expect(
      estimateCost({
        ...zeroUsage,
        provider: "xai",
        model: "grok-4.6",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_read_tokens: 1_000_000,
      }),
    ).toBeCloseTo(8.5, 5);
  });

  it("prices the rest of the published Grok catalog", () => {
    // grok-4.3 and the 4.20 snapshots share one $1.25 / $2.50 tier;
    // grok-build-0.1 is its own $1.00 / $2.00 row.
    for (const model of [
      "grok-4.3",
      "grok-4.20-multi-agent-0309",
      "grok-4.20-0309-reasoning",
      "grok-4.20-0309-non-reasoning",
    ]) {
      expect(
        estimateCost({
          ...zeroUsage,
          provider: "xai",
          model,
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
        }),
      ).toBeCloseTo(3.75, 5);
    }
    expect(
      estimateCost({
        ...zeroUsage,
        provider: "xai",
        model: "grok-build-0.1",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      }),
    ).toBeCloseTo(3, 5);
  });

  // -------------------------------------------------------------------------
  // Provider-reported cost. `cost_usd_ticks` is what the provider actually
  // charged (1e-10 USD) for the rows behind an aggregate; `uncosted_*` are the
  // tokens it did not price and which therefore still need the rate table.
  // -------------------------------------------------------------------------

  it("uses the provider's own cost instead of the rate table when it reports one", () => {
    // Real grok 0.2.106 turn: 2049 uncached input + 10880 cache read + 29
    // output, costUsdTicks 75360000 = $0.007536. Here the rate table would
    // agree, which is what makes it a clean check that the authoritative
    // number is the one being used rather than added to an estimate.
    expect(
      estimateCost({
        ...zeroUsage,
        provider: "grok",
        model: "grok-4.5",
        input_tokens: 2049,
        cache_read_tokens: 10880,
        output_tokens: 29,
        cost_usd_ticks: 75_360_000,
        uncosted_input_tokens: 0,
        uncosted_output_tokens: 0,
        uncosted_cache_read_tokens: 0,
        uncosted_cache_write_tokens: 0,
      }),
    ).toBeCloseTo(0.007536, 10);
  });

  it("keeps the long-context surcharge the rate table cannot express", () => {
    // xAI bills a request at 2x once its prompt reaches 200K tokens. The same
    // tokens priced from the table give the short-context figure; the
    // provider's own number carries the surcharge, and must not be quietly
    // replaced by the cheaper local estimate.
    const tokens = {
      ...zeroUsage,
      provider: "grok",
      model: "grok-4.5",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    };
    const shortContext = estimateCost(tokens);
    expect(shortContext).toBeCloseTo(8, 5);

    const longContext = estimateCost({
      ...tokens,
      cost_usd_ticks: 16 * 10_000_000_000, // $16 — the 2x tier
      uncosted_input_tokens: 0,
      uncosted_output_tokens: 0,
      uncosted_cache_read_tokens: 0,
      uncosted_cache_write_tokens: 0,
    });
    expect(longContext).toBeCloseTo(16, 5);
  });

  it("adds an estimate for the tokens the provider did not price", () => {
    // A bucket can mix rows that carry a provider cost with rows that don't —
    // two providers in one aggregate, or Grok either side of a CLI upgrade.
    // Reporting only the authoritative half would under-report the bucket.
    expect(
      estimateCost({
        ...zeroUsage,
        provider: "grok",
        model: "grok-4.5",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cost_usd_ticks: 4 * 10_000_000_000, // $4 for the priced half
        uncosted_input_tokens: 1_000_000, // $2 at the table rate
        uncosted_output_tokens: 1_000_000, // $6 at the table rate
        uncosted_cache_read_tokens: 0,
        uncosted_cache_write_tokens: 0,
      }),
    ).toBeCloseTo(12, 5);
  });

  it("falls back to estimating the full row when the backend omits the split", () => {
    // A backend older than the cost split sends no `uncosted_*` fields.
    // Treating that as "nothing left to estimate" would report $0 for every
    // row, so an absent split must estimate the full token counts.
    expect(
      estimateCost({
        ...zeroUsage,
        provider: "grok",
        model: "grok-4.5",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      }),
    ).toBeCloseTo(8, 5);
  });

  it("does not double-charge a cost that arrives without its token split", () => {
    // Defensive: an authoritative cost with no `uncosted_*` must not also get
    // a full-row estimate stacked on top.
    expect(
      estimateCost({
        ...zeroUsage,
        provider: "grok",
        model: "grok-4.5",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cost_usd_ticks: 16 * 10_000_000_000,
      }),
    ).toBeCloseTo(16, 5);
  });

  it("reports provider cost even for a model with no rate-table row", () => {
    // `grok-composer-*` has no published rate, but a turn the provider priced
    // itself needs no rate — the money is known exactly.
    expect(
      estimateCost({
        ...zeroUsage,
        provider: "grok",
        model: "grok-composer-2.5-fast",
        input_tokens: 500,
        output_tokens: 100,
        cost_usd_ticks: 12_345_678_900,
        uncosted_input_tokens: 0,
        uncosted_output_tokens: 0,
        uncosted_cache_read_tokens: 0,
        uncosted_cache_write_tokens: 0,
      }),
    ).toBeCloseTo(1.23456789, 8);
  });

  it("keeps the breakdown and the headline agreeing on an unpriced model", () => {
    // `grok-composer-*` has no rate row, so there is nothing to split by — but
    // the provider priced the turn. If the breakdown returned zeros here the
    // stacked chart would read $0 while the headline read the real cost, and
    // the unmapped banner (correctly) would not be shown to explain it.
    const usage = {
      ...zeroUsage,
      provider: "grok",
      model: "grok-composer-2.5-fast",
      input_tokens: 500,
      output_tokens: 100,
      cost_usd_ticks: 12_345_678_900,
      uncosted_input_tokens: 0,
      uncosted_output_tokens: 0,
      uncosted_cache_read_tokens: 0,
      uncosted_cache_write_tokens: 0,
    };
    const b = estimateCostBreakdown(usage);
    expect(b.input + b.output + b.cacheRead + b.cacheWrite).toBeCloseTo(
      estimateCost(usage),
      8,
    );
    expect(b.input).toBeCloseTo(1.23456789, 8);
  });

  it("keeps the cost breakdown summing to the total on provider-priced rows", () => {
    // The stacked chart is drawn from the breakdown while the headline uses
    // estimateCost; if the authoritative charge were dropped from the split
    // the two would silently disagree on every Grok row.
    const usage = {
      ...zeroUsage,
      provider: "grok",
      model: "grok-4.5",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cost_usd_ticks: 16 * 10_000_000_000,
      uncosted_input_tokens: 0,
      uncosted_output_tokens: 0,
      uncosted_cache_read_tokens: 0,
      uncosted_cache_write_tokens: 0,
    };
    const b = estimateCostBreakdown(usage);
    expect(b.input + b.output + b.cacheRead + b.cacheWrite).toBeCloseTo(
      estimateCost(usage),
      5,
    );
    // Split follows the rate table's own proportions ($2 input : $6 output).
    expect(b.input).toBeCloseTo(4, 5);
    expect(b.output).toBeCloseTo(12, 5);
  });
});

describe("user-supplied custom pricing", () => {

  it("does NOT shadow the maintained catalog when both define the same model", () => {
    // Catalog wins so a user can't accidentally over-charge themselves for
    // a model we already track (and so a stale local override doesn't
    // silently disagree with what the dashboard shows everyone else).
    useCustomPricingStore.getState().setCustomPricing("claude-sonnet-4-6", {
      input: 999,
      output: 999,
      cacheRead: 999,
      cacheWrite: 999,
    });
    expect(
      estimateCost({
        ...zeroUsage,
        model: "claude-sonnet-4-6",
        input_tokens: 1_000_000,
      }),
    ).toBeCloseTo(3, 5); // maintained input rate, not the 999 override
  });

  it("falls back to a stripped dated snapshot in the custom store", () => {
    useCustomPricingStore.getState().setCustomPricing("brand-new-model", {
      input: 2,
      output: 8,
      cacheRead: 0.2,
      cacheWrite: 2,
    });
    expect(
      estimateCost({
        ...zeroUsage,
        model: "brand-new-model-2026-04-01",
        input_tokens: 1_000_000,
      }),
    ).toBeCloseTo(2, 5);
  });
});

// ---------------------------------------------------------------------------
// Calendar helpers + weekly aggregation. All of these run on YYYY-MM-DD
// strings (the wire shape of RuntimeUsage.date) and on a runtime-supplied
// IANA timezone — the host browser's tz should never affect the result.
// ---------------------------------------------------------------------------

describe("weekStartIso", () => {
  it("returns the Monday of the same ISO week", () => {
    // 2026-05-19 is a Tuesday → Monday is 2026-05-18.
    expect(weekStartIso("2026-05-19")).toBe("2026-05-18");
  });

  it("treats Monday as the start of its own week (idempotent)", () => {
    expect(weekStartIso("2026-05-18")).toBe("2026-05-18");
  });

  it("rolls Sunday back to the previous Monday", () => {
    // 2026-05-17 is a Sunday → Monday is 2026-05-11.
    expect(weekStartIso("2026-05-17")).toBe("2026-05-11");
  });

  it("crosses month and year boundaries", () => {
    // 2026-01-03 is a Saturday → Monday is 2025-12-29.
    expect(weekStartIso("2026-01-03")).toBe("2025-12-29");
  });
});

describe("addDaysIso", () => {
  it("adds across month boundary", () => {
    expect(addDaysIso("2026-05-30", 3)).toBe("2026-06-02");
  });

  it("subtracts across year boundary", () => {
    expect(addDaysIso("2026-01-02", -5)).toBe("2025-12-28");
  });
});

describe("todayIso", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the runtime's timezone, not the host's, to decide today", () => {
    // 2026-05-19 16:00 UTC. In Asia/Shanghai (UTC+8) it's already 2026-05-20.
    // In America/Los_Angeles (UTC-7 on this date) it's still 2026-05-19.
    vi.setSystemTime(new Date("2026-05-19T16:00:00Z"));
    expect(todayIso("Asia/Shanghai")).toBe("2026-05-20");
    expect(todayIso("America/Los_Angeles")).toBe("2026-05-19");
    expect(todayIso("UTC")).toBe("2026-05-19");
  });
});

describe("aggregateByWeek", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeUsage(
    date: string,
    input: number,
    output: number,
    cacheRead = 0,
    cacheWrite = 0,
  ): RuntimeUsage {
    return {
      runtime_id: "r",
      date,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: input,
      output_tokens: output,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
    };
  }

  it("groups daily rows into Mon-anchored ISO weeks", () => {
    // 2026-05-24 is Sunday, so the calendar week containing "today" is
    // Mon=05-18..Sun=05-24. With weekCount=2 the window covers weeks
    // 2026-05-11 and 2026-05-18 — exactly the two weeks the rows fall in.
    vi.setSystemTime(new Date("2026-05-24T12:00:00Z"));
    // 2026-05-11 is Mon; 2026-05-17 is Sun (same week).
    // 2026-05-18 is Mon (next week).
    const rows = [
      makeUsage("2026-05-11", 1_000_000, 0),
      makeUsage("2026-05-17", 0, 1_000_000),
      makeUsage("2026-05-18", 2_000_000, 0),
    ];
    const { weeklyTokens } = aggregateByWeek(rows, "UTC", 2);
    expect(weeklyTokens).toHaveLength(2);
    expect(weeklyTokens[0]).toMatchObject({
      weekStart: "2026-05-11",
      weekEnd: "2026-05-17",
      input: 1_000_000,
      output: 1_000_000,
      partial: false,
      daysCovered: 7,
    });
    expect(weeklyTokens[1]).toMatchObject({
      weekStart: "2026-05-18",
      weekEnd: "2026-05-24",
      input: 2_000_000,
      partial: false,
      daysCovered: 7,
    });
  });

  it("flags the in-progress week as partial with days-elapsed count", () => {
    // 2026-05-20 is a Wednesday (Mon=05-18, Sun=05-24).
    vi.setSystemTime(new Date("2026-05-20T08:00:00Z"));
    const rows = [makeUsage("2026-05-18", 1_000_000, 0)];
    const { weeklyTokens } = aggregateByWeek(rows, "UTC", 1);
    expect(weeklyTokens[0]).toMatchObject({
      weekStart: "2026-05-18",
      weekEnd: "2026-05-24",
      partial: true,
      daysCovered: 3, // Mon, Tue, Wed
    });
  });

  it("sums costs per week using the model pricing table", () => {
    // 2026-05-17 sits in the calendar week of 2026-05-11..2026-05-17, so
    // weekCount=1 anchors the window on that same week.
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    // 1M input × $3 + 1M output × $15 = $18 per row. Two rows in the same
    // week (Mon + Wed) → $36 weekly total.
    const rows = [
      makeUsage("2026-05-11", 1_000_000, 1_000_000),
      makeUsage("2026-05-13", 1_000_000, 1_000_000),
    ];
    const { weeklyCostStack } = aggregateByWeek(rows, "UTC", 1);
    expect(weeklyCostStack).toHaveLength(1);
    expect(weeklyCostStack[0]?.total).toBeCloseTo(36, 2);
  });

  it("bills cache reads in the weekly stack and its total (MUL-6334)", () => {
    vi.setSystemTime(new Date("2026-05-17T12:00:00Z"));
    // claude-sonnet-4-6: input $3/M, output $15/M, cacheRead $0.30/M,
    // cacheWrite $3.75/M. Row: $3 + $15 + $6 (20M cache reads) + $3.75 = $27.75.
    const rows = [
      makeUsage("2026-05-11", 1_000_000, 1_000_000, 20_000_000, 1_000_000),
    ];
    const { weeklyCostStack } = aggregateByWeek(rows, "UTC", 1);
    const week = weeklyCostStack[0];
    expect(week?.cacheRead).toBeCloseTo(6, 2);
    expect(week?.total).toBeCloseTo(27.75, 2);
    // Same invariant the daily stack holds: bucket total === sum of estimateCost.
    expect(week?.total).toBeCloseTo(
      rows.reduce((sum, r) => sum + estimateCost(r), 0),
      2,
    );
  });

  it("emits trailing calendar weeks pinned to today, dropping older populated weeks", () => {
    // Regression for MUL-2382 weekly window scoping:
    // before the fix, aggregateByWeek built buckets only for weeks that had
    // data and the caller did `.slice(-weekCount)`. With sparse data (an old
    // populated week far outside the selected window plus an empty stretch
    // closer to today), that slice would surface the OLD populated week
    // instead of the trailing in-window weeks. The chart should now show
    // exactly the trailing calendar weeks, with the empty in-range weeks
    // present as zero-valued buckets rather than disappearing.
    vi.setSystemTime(new Date("2026-05-19T12:00:00Z"));
    // 30-day window @ 2026-05-19 → 5 trailing weeks (Mon=04-20, 04-27,
    // 05-04, 05-11, 05-18). 2026-04-13 (Mon) is one week earlier — outside
    // the window. No data in any of the 5 in-range weeks.
    const rows = [makeUsage("2026-04-13", 1_000_000, 1_000_000)];
    const { weeklyTokens, weeklyCostStack } = aggregateByWeek(rows, "UTC", 5);

    expect(weeklyTokens.map((w) => w.weekStart)).toEqual([
      "2026-04-20",
      "2026-04-27",
      "2026-05-04",
      "2026-05-11",
      "2026-05-18",
    ]);
    // Every in-range week is empty — the old populated week was dropped.
    for (const w of weeklyTokens) {
      expect(w.input).toBe(0);
      expect(w.output).toBe(0);
      expect(w.cacheRead).toBe(0);
      expect(w.cacheWrite).toBe(0);
    }
    for (const w of weeklyCostStack) {
      expect(w.total).toBe(0);
    }
  });

  it("keeps in-window weeks empty when nearby data sits inside the window", () => {
    // Sparse-but-in-range case: only the oldest in-window week has data;
    // the remaining trailing weeks must render as empty buckets, not be
    // collapsed to a single populated bar.
    vi.setSystemTime(new Date("2026-05-19T12:00:00Z"));
    const rows = [makeUsage("2026-04-22", 1_000_000, 1_000_000)]; // week of 04-20
    const { weeklyTokens } = aggregateByWeek(rows, "UTC", 5);
    expect(weeklyTokens).toHaveLength(5);
    expect(weeklyTokens[0]).toMatchObject({
      weekStart: "2026-04-20",
      input: 1_000_000,
      output: 1_000_000,
    });
    for (const w of weeklyTokens.slice(1)) {
      expect(w.input).toBe(0);
      expect(w.output).toBe(0);
    }
  });
});

describe("summarizeTaskUsage", () => {
  // claude-opus-5: 5 / 25 / 0.50 / 6.25 per million.
  const opus = {
    provider: "anthropic",
    model: "claude-opus-5",
    input_tokens: 96_000,
    output_tokens: 34_000,
    cache_read_tokens: 712_000,
    cache_write_tokens: 50_000,
  };
  // gpt-5.6-terra: 2.50 / 15 / 0.25 / 3.125 per million.
  const terra = {
    provider: "openai",
    model: "gpt-5.6-terra",
    input_tokens: 31_000,
    output_tokens: 12_000,
    cache_read_tokens: 158_000,
    cache_write_tokens: 11_000,
  };

  it("sums every token bucket into the headline figure", () => {
    const s = summarizeTaskUsage([opus]);
    expect(s?.tokens).toBe(96_000 + 34_000 + 712_000 + 50_000);
    expect(s?.input).toBe(96_000);
    expect(s?.cacheWrite).toBe(50_000);
    expect(s?.models).toEqual(["claude-opus-5"]);
  });

  it("prices each model slice at its own rate, not the combined total", () => {
    // Priced separately: 1.9985 (opus) + 0.331375 (terra).
    // Priced as one blob at either rate, the answer would be wrong.
    const s = summarizeTaskUsage([opus, terra]);
    expect(s?.cost).toBeCloseTo(1.9985 + 0.331375, 5);
    expect(s?.models).toEqual(["claude-opus-5", "gpt-5.6-terra"]);
  });

  it("prefers the provider's own cost over the rate table", () => {
    // 3e10 ticks = $3.00, well above what the rate table would charge, so a
    // rate-table result would be visibly different.
    const s = summarizeTaskUsage([{ ...opus, cost_usd_ticks: 30_000_000_000 }]);
    expect(s?.cost).toBeCloseTo(3, 5);
  });

  it("returns null for no usage rather than a zeroed summary", () => {
    // Both must be null: a run with no recorded usage was not free, and a
    // 0 here would render as "$0.00" and assert that it was.
    expect(summarizeTaskUsage(undefined)).toBeNull();
    expect(summarizeTaskUsage([])).toBeNull();
  });

  it("counts tokens for an unpriced model but leaves its cost at 0", () => {
    const s = summarizeTaskUsage([{ ...opus, model: "totally-made-up-model" }]);
    expect(s?.tokens).toBe(892_000);
    expect(s?.cost).toBe(0);
  });

  it("reports cache savings against full input pricing", () => {
    // 712K cache reads at opus: would have cost 5/M, actually cost 0.50/M.
    const s = summarizeTaskUsage([opus]);
    expect(s?.cacheSavings).toBeCloseTo((712_000 * (5 - 0.5)) / 1_000_000, 5);
  });
});

describe("summarizeTaskUsageAcross", () => {
  const slice = {
    model: "claude-opus-5",
    input_tokens: 1_000_000,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };

  it("skips runs with no usage instead of nulling the whole total", () => {
    const total = summarizeTaskUsageAcross([[slice], undefined, [], [slice]]);
    expect(total?.tokens).toBe(2_000_000);
    expect(total?.cost).toBeCloseTo(10, 5);
  });

  it("is null only when no run has any usage", () => {
    expect(summarizeTaskUsageAcross([undefined, [], undefined])).toBeNull();
    expect(summarizeTaskUsageAcross([])).toBeNull();
  });
});

describe("formatTokens", () => {
  it("uses a compact unit ladder for large token counts", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_000)).toBe("1K");
    expect(formatTokens(1_050)).toBe("1.1K");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(2_200_000_000)).toBe("2.2B");
    expect(formatTokens(29_513_100_000)).toBe("29.5B");
    expect(formatTokens(1_000_000_000_000)).toBe("1T");
  });

  it("promotes values that round across a unit boundary", () => {
    expect(formatTokens(999_949)).toBe("999.9K");
    expect(formatTokens(999_950)).toBe("1M");
    expect(formatTokens(999_999_999)).toBe("1B");
  });
});
