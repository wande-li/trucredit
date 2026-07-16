/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "prettier",
  ],
  globals: {
    shopify: "readonly"
  },
  rules: {
    // ══ Enforcement: zero empty catch blocks ══
    "no-empty": ["error", { "allowEmptyCatch": false }],

    // ══ Enforcement: zero ts-nocheck / ts-ignore ══
    "@typescript-eslint/ban-ts-comment": ["error", {
      "ts-expect-error": false,
      "ts-ignore": true,
      "ts-nocheck": true,
      "ts-check": false,
    }],

    // ══ Error: console.log/error in production paths ══
    "no-console": ["error", { "allow": ["warn", "error"] }],

    // ══ Error: explicit any — zero tolerance ══
    "@typescript-eslint/no-explicit-any": "error",

    // ══ Error: unused variables (catch bugs early) ══
    "@typescript-eslint/no-unused-vars": ["error", {
      "argsIgnorePattern": "^_",
      "varsIgnorePattern": "^_",
    }],
  },
};
