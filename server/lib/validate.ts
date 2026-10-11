/**
 * A small, dependency-free runtime validator with static type inference.
 *
 * Navoro deliberately has zero runtime npm dependencies so a downloaded release
 * runs with nothing but Node. This covers exactly what the API needs: strict
 * objects (unknown keys rejected), strings with length bounds, numbers, booleans,
 * enums, arrays with size caps, optional and nullable fields.
 */

export interface Issue {
  path: string;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

export interface Schema<T> {
  readonly _type?: T;
  parse(input: unknown, path?: string): Result<T>;
  readonly isOptional?: boolean;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

function fail<T>(path: string, message: string): Result<T> {
  return { ok: false, issues: [{ path: path || '(root)', message }] };
}

export function string(options: { min?: number; max?: number; trim?: boolean; pattern?: RegExp; patternMessage?: string } = {}): Schema<string> {
  const { min = 0, max = 10_000, trim = true, pattern, patternMessage } = options;
  return {
    parse(input, path = '') {
      if (typeof input !== 'string') return fail(path, 'Expected a string');
      const value = trim ? input.trim() : input;
      if (value.length < min) return fail(path, min === 1 ? 'Required' : `Must be at least ${min} characters`);
      if (value.length > max) return fail(path, `Must be at most ${max} characters`);
      if (pattern && !pattern.test(value)) return fail(path, patternMessage ?? 'Invalid format');
      return { ok: true, value };
    },
  };
}

export function number(options: { min?: number; max?: number; integer?: boolean } = {}): Schema<number> {
  return {
    parse(input, path = '') {
      if (typeof input !== 'number' || !Number.isFinite(input)) return fail(path, 'Expected a number');
      if (options.integer && !Number.isInteger(input)) return fail(path, 'Expected an integer');
      if (options.min !== undefined && input < options.min) return fail(path, `Must be ≥ ${options.min}`);
      if (options.max !== undefined && input > options.max) return fail(path, `Must be ≤ ${options.max}`);
      return { ok: true, value: input };
    },
  };
}

export function boolean(): Schema<boolean> {
  return {
    parse(input, path = '') {
      return typeof input === 'boolean' ? { ok: true, value: input } : fail(path, 'Expected true or false');
    },
  };
}

export function literal<const T extends string | number | boolean>(expected: T): Schema<T> {
  return {
    parse(input, path = '') {
      return input === expected ? { ok: true, value: expected } : fail(path, `Expected ${JSON.stringify(expected)}`);
    },
  };
}

export function oneOf<const T extends readonly string[]>(values: T): Schema<T[number]> {
  return {
    parse(input, path = '') {
      return typeof input === 'string' && (values as readonly string[]).includes(input)
        ? { ok: true, value: input as T[number] }
        : fail(path, `Expected one of: ${values.join(', ')}`);
    },
  };
}

export function array<T>(item: Schema<T>, options: { min?: number; max?: number; unique?: boolean } = {}): Schema<T[]> {
  const { min = 0, max = 500 } = options;
  return {
    parse(input, path = '') {
      if (!Array.isArray(input)) return fail(path, 'Expected a list');
      if (input.length < min) return fail(path, `Must contain at least ${min} item(s)`);
      if (input.length > max) return fail(path, `Must contain at most ${max} items`);
      const out: T[] = [];
      const issues: Issue[] = [];
      input.forEach((value, index) => {
        const result = item.parse(value, `${path}[${index}]`);
        if (result.ok) out.push(result.value);
        else issues.push(...result.issues);
      });
      if (issues.length) return { ok: false, issues };
      return { ok: true, value: options.unique ? [...new Set(out)] : out };
    },
  };
}

export function optional<T>(schema: Schema<T>): Schema<T | undefined> {
  return {
    isOptional: true,
    parse(input, path = '') {
      if (input === undefined) return { ok: true, value: undefined };
      return schema.parse(input, path);
    },
  };
}

export function nullable<T>(schema: Schema<T>): Schema<T | null> {
  return {
    parse(input, path = '') {
      if (input === null) return { ok: true, value: null };
      return schema.parse(input, path);
    },
  };
}

type Shape = Record<string, Schema<unknown>>;
type OptionalKeys<S extends Shape> = { [K in keyof S]: undefined extends Infer<S[K]> ? K : never }[keyof S];
type RequiredKeys<S extends Shape> = Exclude<keyof S, OptionalKeys<S>>;
export type ObjectOf<S extends Shape> = { [K in RequiredKeys<S>]: Infer<S[K]> } & { [K in OptionalKeys<S>]?: Infer<S[K]> };

/** Strict object: unknown keys are rejected so typos and smuggled fields fail loudly. */
export function object<S extends Shape>(shape: S, options: { allowUnknown?: boolean } = {}): Schema<ObjectOf<S>> {
  return {
    parse(input, path = '') {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) return fail(path, 'Expected an object');
      const record = input as Record<string, unknown>;
      const issues: Issue[] = [];
      const out: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(shape)) {
        const result = schema.parse(record[key], path ? `${path}.${key}` : key);
        if (result.ok) {
          if (result.value !== undefined) out[key] = result.value;
        } else {
          issues.push(...result.issues);
        }
      }
      if (!options.allowUnknown) {
        for (const key of Object.keys(record)) {
          if (!(key in shape)) issues.push({ path: path ? `${path}.${key}` : key, message: 'Unknown field' });
        }
      }
      if (issues.length) return { ok: false, issues };
      return { ok: true, value: out as ObjectOf<S> };
    },
  };
}

export function union<A, B>(a: Schema<A>, b: Schema<B>): Schema<A | B> {
  return {
    parse(input, path = '') {
      const first = a.parse(input, path);
      if (first.ok) return first;
      const second = b.parse(input, path);
      if (second.ok) return second;
      return { ok: false, issues: [...first.issues, ...second.issues] };
    },
  };
}

/** Wrap a schema with an extra check that runs after it parses successfully. */
export function refine<T>(schema: Schema<T>, check: (value: T) => string | null): Schema<T> {
  return {
    isOptional: schema.isOptional,
    parse(input, path = '') {
      const result = schema.parse(input, path);
      if (!result.ok) return result;
      const message = check(result.value);
      return message ? fail(path, message) : result;
    },
  };
}

export const v = { string, number, boolean, literal, oneOf, array, optional, nullable, object, union, refine };
