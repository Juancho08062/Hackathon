// Lint config: browser scripts in src/, Node scripts in tests/. Vendored libraries and the built index.html are skipped.
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["vendor/**", "index.html", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        module: "readonly", require: "readonly",
        d3: "readonly", Engine: "readonly", Ingest: "readonly", Libs: "readonly", Formats: "readonly", Scene3D: "readonly", SeamMap: "readonly", SeamAgent: "readonly", maplibregl: "readonly",
      },
    },
    rules: { "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] },
  },
  {
    files: ["tests/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: globals.node },
  },
];
