// Exact money arithmetic for the HR calculations (Versiya 3.60): every value is a fraction of two BigInts, so dividing by 12
// or by 30,4 loses nothing and nothing is rounded until a final amount is shown in qəpik. Plain JS numbers are only read in
// (from the database or a form) through their decimal text, so 0.1 stays exactly one tenth.

const ZERO = BigInt(0), ONE = BigInt(1), TEN = BigInt(10);
const abs = (n: bigint) => (n < ZERO ? -n : n);
function gcd(a: bigint, b: bigint): bigint {
  a = abs(a); b = abs(b);
  while (b) { const t = a % b; a = b; b = t; }
  return a || ONE;
}

export class Dec {
  readonly n: bigint;
  readonly d: bigint;
  private constructor(n: bigint, d: bigint) {
    if (d === ZERO) throw new Error("Sıfıra bölmə.");
    if (d < ZERO) { n = -n; d = -d; }
    const g = gcd(n, d);
    this.n = n / g; this.d = d / g;
  }

  static readonly zero = new Dec(ZERO, ONE);

  // A number or decimal text ("1234.56", "1234,56", "1e-3"). Anything that is not a finite number is refused, never taken as 0.
  static of(value: number | string | bigint | Dec): Dec {
    if (value instanceof Dec) return value;
    if (typeof value === "bigint") return new Dec(value, ONE);
    const text = (typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : String(value).trim().replace(",", "."));
    const m = text.match(/^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
    if (!m || (!m[2] && !m[3])) throw new Error(`Rəqəm düzgün deyil: "${String(value)}".`);
    const digits = `${m[2] || ""}${m[3] || ""}` || "0";
    let scale = (m[3] || "").length - Number(m[4] || 0);
    let n = BigInt(digits);
    if (m[1] === "-") n = -n;
    if (scale < 0) { n *= TEN ** BigInt(-scale); scale = 0; }
    return new Dec(n, TEN ** BigInt(scale));
  }
  static ratio(a: number | string | Dec, b: number | string | Dec) { return Dec.of(a).div(b); }
  static sum(values: (number | string | Dec)[]) { return values.reduce<Dec>((total, v) => total.add(v), Dec.zero); }

  add(v: number | string | Dec) { const o = Dec.of(v); return new Dec(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(v: number | string | Dec) { const o = Dec.of(v); return new Dec(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(v: number | string | Dec) { const o = Dec.of(v); return new Dec(this.n * o.n, this.d * o.d); }
  div(v: number | string | Dec) { const o = Dec.of(v); if (o.n === ZERO) throw new Error("Sıfıra bölmə."); return new Dec(this.n * o.d, this.d * o.n); }
  neg() { return new Dec(-this.n, this.d); }
  cmp(v: number | string | Dec) { const o = Dec.of(v); const a = this.n * o.d, b = o.n * this.d; return a === b ? 0 : a < b ? -1 : 1; }
  lt(v: number | string | Dec) { return this.cmp(v) < 0; }
  gt(v: number | string | Dec) { return this.cmp(v) > 0; }
  isZero() { return this.n === ZERO; }
  isNeg() { return this.n < ZERO; }
  min(v: number | string | Dec) { const o = Dec.of(v); return this.cmp(o) <= 0 ? this : o; }
  max(v: number | string | Dec) { const o = Dec.of(v); return this.cmp(o) >= 0 ? this : o; }

  // Rounded to `places` decimals, half away from zero (the usual rule for money: 0,005 → 0,01).
  round(places = 2): Dec {
    const scale = TEN ** BigInt(places);
    const scaled = this.n * scale;
    const sign = scaled < ZERO ? -ONE : ONE;
    const q = abs(scaled) / this.d, r = abs(scaled) % this.d;
    const rounded = (r * BigInt(2) >= this.d ? q + ONE : q) * sign;
    return new Dec(rounded, scale);
  }
  // Whole qəpik as a BigInt (after rounding).
  cents(): bigint { const r = this.round(2); return (r.n * BigInt(100)) / r.d; }
  static fromCents(cents: bigint) { return new Dec(cents, BigInt(100)); }
  toFixed(places = 2) {
    const r = this.round(places);
    const scale = TEN ** BigInt(places);
    const whole = (r.n * scale) / r.d;
    const sign = whole < ZERO ? "-" : "";
    const text = abs(whole).toString().padStart(places + 1, "0");
    return places ? `${sign}${text.slice(0, -places)}.${text.slice(-places)}` : `${sign}${text}`;
  }
  // For display and JSON only: the rounded value as a JS number.
  toNumber(places = 2) { return Number(this.toFixed(places)); }
  toString() { return this.toFixed(2); }
}

// Splits a total (already rounded to qəpik) over parts in proportion to their exact shares, so the rounded parts add up to the
// total exactly: each part is rounded, and the difference left by rounding goes to the parts with the largest remainders.
export function allocateCents(total: Dec, shares: Dec[]): Dec[] {
  const target = total.cents();
  if (!shares.length) return [];
  const sumShares = Dec.sum(shares);
  if (sumShares.isZero()) return shares.map((_, i) => (i === shares.length - 1 ? Dec.fromCents(target) : Dec.zero));
  const exact = shares.map((s) => total.mul(s).div(sumShares).mul(100));
  const floors = exact.map((e) => (e.n >= ZERO ? e.n / e.d : -((-e.n + e.d - ONE) / e.d)));
  let left = target - floors.reduce((a, b) => a + b, ZERO);
  const order = exact.map((e, i) => ({ i, rest: e.sub(Dec.of(floors[i])) })).sort((a, b) => b.rest.cmp(a.rest) || a.i - b.i);
  const result = [...floors];
  for (let k = 0; left > ZERO && k < order.length; k++, left -= ONE) result[order[k].i] += ONE;
  return result.map((c) => Dec.fromCents(c));
}
