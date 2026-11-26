// ESLint 9 flat config.
// Ported from the legacy .eslintrc.cjs (removed) with the repo's
// legacy-compat rule overrides preserved verbatim, then trimmed back rule by
// rule as the codebase was made to pass them (see LEGACY_COMPAT_RULES).
//
// NOTE on the duplicate-import guard (see design.md): ESLint rules do not
// reliably detect the cross-module same-name collision that caused the Menu
// bug (verified empirically). The reliable guard is `tsc`'s "TS2300: Duplicate
// identifier" — ensure the build's type-check (vite build / checker) runs.
import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tseslintParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Rules held off for legacy compatibility.
 *
 * One shared object, used by both the renderer and the electron scopes, so the
 * two cannot drift apart — they previously carried two hand-copied lists that
 * had already diverged. Each entry is a deliberate decision, not an oversight:
 * the rule either needs a mechanical fix across hundreds of sites, or flags a
 * pattern this codebase relies on.
 *
 * Nine rules that used to be listed here are now enforced (see
 * ENFORCED_RULES). Each was verified to produce zero violations first:
 *
 *   - `react-hooks/rules-of-hooks` — found one real bug: HomeFeaturedApps.tsx
 *     called a `useEffectEvent` from a pointer handler, where it may not be
 *     called. Fixed by making it a plain `useCallback` (it only touches refs).
 *   - `no-async-promise-executor` — three sites, two of them latent hangs (an
 *     `await` in the executor that threw left the promise pending forever).
 *   - `no-constant-binary-expression` — found a real bug in MintingStats.tsx:
 *     `a + b ? c : d` parsed as `(a + b) ? c : d`, so the "Synchronizing"
 *     label was always discarded. Fixed.
 *   - `no-control-regex`, `prefer-rest-params`,
 *     `no-misleading-character-class`, `no-extra-boolean-cast`,
 *     `no-constant-condition` — a handful of sites, each either fixed or
 *     given a documented one-line exception.
 *
 * Note that removing a rule from this list is not by itself enough to enforce
 * it: a rule that is absent everywhere stays off. Anything meant to be
 * enforced belongs in ENFORCED_RULES, so the intent is visible.
 */
const LEGACY_COMPAT_RULES = {
  '@typescript-eslint/no-unused-vars': 'off',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/ban-ts-comment': 'off',
  '@typescript-eslint/no-empty-function': 'off',
  '@typescript-eslint/no-var-requires': 'off',
  '@typescript-eslint/no-require-imports': 'off',
  '@typescript-eslint/no-empty-object-type': 'off',
  '@typescript-eslint/no-unused-expressions': 'off',
  '@typescript-eslint/no-wrapper-object-types': 'off',
  // Optional chaining in a position where a short circuit would throw
  // (e.g. `a?.b()` used as a value). Real, but needs a case-by-case fix.
  'no-unsafe-optional-chaining': 'off',
  // Mechanical rewrites across hundreds of sites (820 and 118 hits). Worth
  // doing, but not mixed into a merge of this size.
  'no-var': 'off',
  'prefer-const': 'off',
  // 64 and 145 hits, each needing a judgement call per site.
  'no-empty': 'off',
  'no-case-declarations': 'off',
  // 55 hits, and NOT in @eslint/js's recommended set, so dropping it here
  // would silently leave it unenforced rather than turn it on. All 55 are a
  // value import followed by a type import of the same module — the shape
  // `import/consistent-type-specifier-style` would merge, not core
  // `no-duplicate-imports` (`eslint --fix` cannot collapse them).
  'no-duplicate-imports': 'off',
  // 251 hits. Valuable, but it needs a deliberate campaign rather than a
  // blanket enable: most are intentional one-shot effects.
  'react-hooks/exhaustive-deps': 'off',
};

/**
 * Rules this repo enforces on both scopes, listed so the intent is explicit.
 * Everything here has been verified to pass with zero violations.
 */
const ENFORCED_RULES = {
  // Correctness: calling a hook outside a component/effect is a bug.
  'react-hooks/rules-of-hooks': 'error',
  // Not in @eslint/js's recommended set, so it must be set explicitly or it
  // stays off regardless of whether it is listed as "off".
  'prefer-rest-params': 'error',
};

export default [
  {
    // NOTE: this object must contain *only* `ignores`. In flat config, a
    // config object whose sole key is `ignores` is the one global ignore list;
    // adding any other key (even `linterOptions`) silently demotes it to a
    // scoped ignore, and generated bundles get linted again.
    ignores: [
      'dist',
      // Renderer build output and the Capacitor-copied web app.
      'electron/app',
      // Compiled main-process output, and the generated worker bundles that the
      // `pretest` script writes here.
      'electron/build',
      'electron/resources/reticulum-runtime',
      'electron/native',
      // Generated by `npx cap sync`; not ours to lint.
      'electron/capacitor.config.ts',
      // The Capacitor CLI writes this file verbatim from its own template,
      // including a lint directive header for a `require()` it no longer
      // emits; it is regenerated by `cap sync`, so it is not ours to lint.
      'electron/src/rt/electron-plugins.js',
      'capacitor.config.ts',
    ],
  },
  {
    // A stale `// eslint-disable-next-line` must not fail the build.
    //
    // This is a diagnostic about *our config*, not about the code it covers:
    // a directive becomes "unused" purely because the rule it names is off at
    // that line. Turning a rule off — which LEGACY_COMPAT_RULES does — silently
    // invalidates every directive upstream ever wrote for that rule, and
    // ESLint 9 reports it as a warning by default. With `--max-warnings 0`,
    // every upstream merge then breaks lint on code we did not write.
    //
    // Set here rather than only in the `lint` script so editors and every other
    // ESLint invocation agree. `npm run lint:directives` still reports them on
    // demand when cleaning up.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...eslint.configs.recommended,
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...tseslint.configs['flat/recommended'][0],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...tseslint.configs['flat/recommended'][1],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...tseslint.configs['flat/recommended'][2],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-refresh/only-export-components': [
        'off',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-array-constructor': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/ban-types': 'off',
      ...ENFORCED_RULES,
      ...LEGACY_COMPAT_RULES,
    },
  },
  // ---------------------------------------------------------------------------
  // electron/ and root config files.
  //
  // Until this block existed, `eslint.config.js` configured only
  // `src/**/*.{ts,tsx}`. Every other file fell through to ESLint's default
  // TypeScript-less parser, so all ~153 `electron/**/*.ts` files reported
  // `Parsing error: Unexpected token type` and `npm run lint` could never pass.
  // Because lint is not wired into CI, the breakage went unnoticed.
  //
  // The rule set is the same shared LEGACY_COMPAT_RULES as the renderer's, so
  // the two scopes cannot drift. `react-hooks` is registered here too even
  // though the main process renders nothing: without it the plugin is simply
  // absent for this scope, which is how the drift went unnoticed before.
  // ---------------------------------------------------------------------------
  {
    files: [
      'electron/**/*.{ts,tsx,js,cjs,mjs}',
      '*.config.ts',
      '*.config.js',
      '*.js',
    ],
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    ...eslint.configs.recommended,
    plugins: {
      ...eslint.configs.recommended.plugins,
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
    },
    rules: {
      ...eslint.configs.recommended.rules,
      ...ENFORCED_RULES,
      ...LEGACY_COMPAT_RULES,
      // No DOM globals in the main process; the TS parser already reports
      // genuine undefined references there.
      'no-undef': 'off',
    },
  },
];
