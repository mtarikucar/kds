import {
  DEFAULT_TENANT_TZ,
  MIN_LINE_CENTS,
  ROLL_FORWARD_THRESHOLD_DAYS,
  anchorDateFor,
  daysBetweenUtc,
  nextAnniversary,
  previousAnniversary,
  prorate,
} from "./anniversary";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("anniversary — anchorDateFor", () => {
  it("stores the TENANT-LOCAL calendar date, not the raw UTC date", () => {
    // 10 Mar 2026 01:00 Istanbul == 09 Mar 2026 22:00 UTC. Storing the raw
    // instant would put the anniversary on 9 March forever.
    const instant = new Date("2026-03-09T22:00:00.000Z");
    expect(anchorDateFor(instant, DEFAULT_TENANT_TZ)).toEqual(utc("2026-03-10"));
  });

  it("does not shift a mid-day local instant", () => {
    const instant = new Date("2026-03-10T09:30:00.000Z"); // 12:30 TRT
    expect(anchorDateFor(instant, DEFAULT_TENANT_TZ)).toEqual(utc("2026-03-10"));
  });

  it("keeps the UTC date when the tenant runs on UTC", () => {
    const instant = new Date("2026-03-09T22:00:00.000Z");
    expect(anchorDateFor(instant, "UTC")).toEqual(utc("2026-03-09"));
  });

  it("is idempotent on an already-normalized anchor", () => {
    const anchor = utc("2026-03-10");
    expect(anchorDateFor(anchor, "UTC")).toEqual(anchor);
  });
});

describe("anniversary — next/previous", () => {
  it("rolls to next year when bought ON the anniversary (full fresh cycle)", () => {
    expect(nextAnniversary(utc("2026-03-10"), utc("2026-03-10"))).toEqual(
      utc("2027-03-10"),
    );
  });

  it("returns the upcoming anniversary mid-cycle", () => {
    expect(nextAnniversary(utc("2026-03-10"), utc("2026-03-20"))).toEqual(
      utc("2027-03-10"),
    );
  });

  it("returns the anniversary one day out", () => {
    expect(nextAnniversary(utc("2026-03-10"), utc("2027-03-09"))).toEqual(
      utc("2027-03-10"),
    );
  });

  it("previousAnniversary is today when today IS the anniversary", () => {
    expect(previousAnniversary(utc("2026-03-10"), utc("2027-03-10"))).toEqual(
      utc("2027-03-10"),
    );
  });

  it("previousAnniversary walks back a year mid-cycle", () => {
    expect(previousAnniversary(utc("2026-03-10"), utc("2026-03-20"))).toEqual(
      utc("2026-03-10"),
    );
  });

  it("clamps a 29 Feb anchor to 28 Feb in common years", () => {
    // 2028 is a leap year; 2029 is not.
    expect(nextAnniversary(utc("2028-02-29"), utc("2028-06-01"))).toEqual(
      utc("2029-02-28"),
    );
  });

  it("restores 29 Feb on the next leap year", () => {
    expect(nextAnniversary(utc("2028-02-29"), utc("2031-06-01"))).toEqual(
      utc("2032-02-29"),
    );
  });

  it("handles a 31-day anchor landing in a 30-day month", () => {
    expect(nextAnniversary(utc("2026-01-31"), utc("2026-06-01"))).toEqual(
      utc("2027-01-31"),
    );
  });
});

describe("anniversary — daysBetweenUtc", () => {
  it("counts whole days across a common year", () => {
    expect(daysBetweenUtc(utc("2026-03-10"), utc("2027-03-10"))).toBe(365);
  });

  it("counts 366 across a leap-day window", () => {
    // 2027-03-10 → 2028-03-10 contains 29 Feb 2028.
    expect(daysBetweenUtc(utc("2027-03-10"), utc("2028-03-10"))).toBe(366);
  });

  it("counts the worked example", () => {
    expect(daysBetweenUtc(utc("2026-03-20"), utc("2027-03-10"))).toBe(355);
  });

  it("is zero for the same day and never negative-by-rounding", () => {
    expect(daysBetweenUtc(utc("2026-03-10"), utc("2026-03-10"))).toBe(0);
  });
});

describe("anniversary — prorate", () => {
  const ANNUAL = 129_000; // ₺1.290,00 — Gelişmiş Rapor & Analitik

  it("charges the full annual price when buying ON the anniversary", () => {
    const r = prorate({
      annualPriceCents: ANNUAL,
      anchorAt: utc("2026-03-10"),
      now: utc("2027-03-10"),
    });
    expect(r.mode).toBe("full");
    expect(r.unitCents).toBe(ANNUAL);
    expect(r.cycleDays).toBe(366); // 2027-03-10 → 2028-03-10
    expect(r.billedDays).toBe(366);
    expect(r.periodEnd).toEqual(utc("2028-03-10"));
  });

  it("prices the spec's worked example exactly", () => {
    // anchor 10 Mar 2026, buy 20 Mar 2026 → 355/365 of ₺1.290,00
    const r = prorate({
      annualPriceCents: ANNUAL,
      anchorAt: utc("2026-03-10"),
      now: utc("2026-03-20"),
    });
    expect(r.mode).toBe("prorated");
    expect(r.remainingDays).toBe(355);
    expect(r.cycleDays).toBe(365);
    expect(r.unitCents).toBe(125_466); // round(129000 * 355/365)
    expect(r.periodStart).toEqual(utc("2026-03-20"));
    expect(r.periodEnd).toEqual(utc("2027-03-10"));
  });

  it("defines the anchor from `now` when the tenant has none yet", () => {
    const r = prorate({
      annualPriceCents: ANNUAL,
      anchorAt: null,
      now: new Date("2026-03-09T22:00:00.000Z"), // 10 Mar 01:00 TRT
    });
    expect(r.anchorAt).toEqual(utc("2026-03-10"));
    expect(r.mode).toBe("full");
    expect(r.unitCents).toBe(ANNUAL);
    expect(r.periodEnd).toEqual(utc("2027-03-10"));
  });

  it("rolls forward into the next cycle inside the threshold window", () => {
    // 9 days left (<= 14): charge the stub AND the next full cycle so the
    // buyer doesn't get a renewal invoice a week later.
    const r = prorate({
      annualPriceCents: ANNUAL,
      anchorAt: utc("2026-03-10"),
      now: utc("2027-03-01"),
    });
    expect(r.mode).toBe("rollForward");
    expect(r.remainingDays).toBe(9);
    expect(r.cycleDays).toBe(365); // current cycle 2026-03-10 → 2027-03-10
    expect(r.billedDays).toBe(9 + 366); // + next cycle (leap)
    // stub at the current-cycle rate, plus one full year at list price
    expect(r.unitCents).toBe(Math.round((ANNUAL * 9) / 365) + ANNUAL);
    expect(r.periodEnd).toEqual(utc("2028-03-10"));
  });

  it("stays prorated just outside the threshold window", () => {
    const r = prorate({
      annualPriceCents: ANNUAL,
      anchorAt: utc("2026-03-10"),
      now: utc("2027-02-20"),
    });
    expect(r.remainingDays).toBe(18);
    expect(r.remainingDays).toBeGreaterThan(ROLL_FORWARD_THRESHOLD_DAYS);
    expect(r.mode).toBe("prorated");
    expect(r.periodEnd).toEqual(utc("2027-03-10"));
  });

  it("rounds per unit THEN multiplies so unit*qty === subtotal exactly", () => {
    const r = prorate({
      annualPriceCents: ANNUAL,
      anchorAt: utc("2026-03-10"),
      now: utc("2026-03-20"),
      quantity: 3,
    });
    expect(r.unitCents).toBe(125_466);
    expect(r.subtotalCents).toBe(125_466 * 3);
    expect(r.subtotalCents).toBe(r.unitCents * 3);
  });

  it("floors a near-zero remainder at MIN_LINE_CENTS (PayTR rejects 0)", () => {
    // A ₺1 item with 1 day left would round to 0 kuruş.
    const r = prorate({
      annualPriceCents: 100,
      anchorAt: utc("2026-03-10"),
      now: utc("2027-03-09"),
    });
    expect(r.mode).toBe("rollForward"); // 1 day left is inside the window
    expect(r.unitCents).toBeGreaterThanOrEqual(MIN_LINE_CENTS);
  });

  it("respects the tenant timezone when resolving `today`", () => {
    // 20 Mar 2026 01:00 TRT == 19 Mar 22:00 UTC. Under Istanbul the buyer is
    // on the 20th (355 days left); under UTC they are on the 19th (356).
    const instant = new Date("2026-03-19T22:00:00.000Z");
    const ist = prorate({
      annualPriceCents: ANNUAL,
      anchorAt: utc("2026-03-10"),
      now: instant,
      tz: DEFAULT_TENANT_TZ,
    });
    const gmt = prorate({
      annualPriceCents: ANNUAL,
      anchorAt: utc("2026-03-10"),
      now: instant,
      tz: "UTC",
    });
    expect(ist.remainingDays).toBe(355);
    expect(gmt.remainingDays).toBe(356);
  });

  it("never charges more than the annual price while prorating", () => {
    const anchor = utc("2026-03-10");
    for (let d = ROLL_FORWARD_THRESHOLD_DAYS + 1; d <= 365; d++) {
      const now = new Date(utc("2027-03-10").getTime() - d * 86_400_000);
      const r = prorate({ annualPriceCents: ANNUAL, anchorAt: anchor, now });
      expect(r.unitCents).toBeLessThanOrEqual(ANNUAL);
    }
  });

  it("decreases monotonically as the cycle burns down", () => {
    const anchor = utc("2026-03-10");
    let prev = Number.POSITIVE_INFINITY;
    for (let d = 365; d > ROLL_FORWARD_THRESHOLD_DAYS; d--) {
      const now = new Date(utc("2027-03-10").getTime() - d * 86_400_000);
      const { unitCents } = prorate({
        annualPriceCents: ANNUAL,
        anchorAt: anchor,
        now,
      });
      expect(unitCents).toBeLessThanOrEqual(prev);
      prev = unitCents;
    }
  });

  it("rejects a negative price rather than silently crediting the tenant", () => {
    expect(() =>
      prorate({
        annualPriceCents: -1,
        anchorAt: utc("2026-03-10"),
        now: utc("2026-03-20"),
      }),
    ).toThrow(/annualPriceCents/);
  });

  it("rejects a non-positive quantity", () => {
    expect(() =>
      prorate({
        annualPriceCents: ANNUAL,
        anchorAt: utc("2026-03-10"),
        now: utc("2026-03-20"),
        quantity: 0,
      }),
    ).toThrow(/quantity/);
  });

  it("prices a free item as free without hitting the minimum floor", () => {
    const r = prorate({
      annualPriceCents: 0,
      anchorAt: utc("2026-03-10"),
      now: utc("2026-03-20"),
    });
    expect(r.unitCents).toBe(0);
    expect(r.subtotalCents).toBe(0);
  });
});
