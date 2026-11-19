import globals from "globals";

/**
 * Minimal lint gate.
 *
 * This exists for one reason: src/components/shared/GlobalMobileSync.js shipped
 * to production rendering <Shirt />, <Scissors /> and <LogoIcon /> without ever
 * importing or defining them. It is mounted in the root layout, so every mobile
 * upload threw a ReferenceError and blanked the whole app. `next build`
 * compiles that happily, and tsconfig.json only includes .ts/.tsx — so the
 * ~125 .js files that make up the application had no static analysis at all.
 *
 * Deliberately narrow: `no-undef` is the rule that catches that bug class.
 * Stylistic rules are left off so this reports real defects only, and the
 * `lint` script is part of the release build so undefined runtime identifiers
 * fail verification before deployment.
 */
export default [
  {
    ignores: [
      "node_modules/**",
      ".tmp/**",
      ".workflow-data/**",
      "src/app/.well-known/workflow/**",
      ".next/**",
      "scripts/**",
      "scratch/**",
      "tests/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "public/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.jsx", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        React: "readonly",
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
    },
  },
];
