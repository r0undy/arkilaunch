// A tiny arithmetic evaluator for the admin's truck price formula: numbers,
// + - * /, parentheses, unary minus, and whitelisted variable names. No
// eval/Function, no property access, no calls -- anything else is a parse
// error. Recursive descent over a token list.

export const FORMULA_BASE_VARS = [
  'km',
  'base',
  'per_km',
  'diesel',
  'fuel_l_per_km',
  'driver_fee',
  'tolls',
  'weight_t',
  'extras',
] as const;

const MAX_LENGTH = 500;
const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|([a-z_][a-z0-9_]*)|([-+*/()]))/y;

export class FormulaError extends Error {}

// An extra's label as a formula variable: "Helper fee" -> helper_fee.
export function formulaVarName(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, '_$1');
}

function tokenize(src: string): string[] {
  if (src.length > MAX_LENGTH) throw new FormulaError('formula too long');
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(TOKEN.lastIndex))) break;
    const at = TOKEN.lastIndex;
    const m = TOKEN.exec(src);
    if (!m) throw new FormulaError(`unexpected character at ${at + 1}`);
    tokens.push(m[1] ?? m[2] ?? m[3]!);
  }
  return tokens;
}

export function evaluateFormula(src: string, vars: Record<string, number>): number {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];

  function primary(): number {
    const t = tokens[i++];
    if (t === undefined) throw new FormulaError('unexpected end of formula');
    if (t === '(') {
      const v = expr();
      if (tokens[i++] !== ')') throw new FormulaError('missing )');
      return v;
    }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    if (/^\d/.test(t)) return Number(t);
    if (/^[a-z_]/.test(t)) {
      if (!Object.prototype.hasOwnProperty.call(vars, t)) throw new FormulaError(`unknown variable ${t}`);
      return vars[t]!;
    }
    throw new FormulaError(`unexpected ${t}`);
  }
  function term(): number {
    let v = primary();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[i++];
      const r = primary();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr(): number {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  const value = expr();
  if (i !== tokens.length) throw new FormulaError(`unexpected ${tokens[i]}`);
  if (!Number.isFinite(value)) throw new FormulaError('formula result is not a finite number');
  return value;
}
