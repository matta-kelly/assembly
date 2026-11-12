import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["**/node_modules", "work/dist"]),
  {
    files: ["**/*.ts"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.node },
  },
  tseslint.configs.recommended,
  // A promise is awaited, returned, or marked `void` on purpose: the loop starts work without waiting, and says so.
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { "@typescript-eslint/no-floating-promises": "error" },
  },
  // Code that is not used is deleted, not commented out: git keeps the history.
  {
    files: ["**/*.ts"],
    plugins: { sonarjs },
    rules: { "sonarjs/no-commented-code": "error" },
  },
  // One import per module: a second import of it hides what the file takes from it.
  {
    files: ["**/*.ts"],
    rules: { "no-duplicate-imports": "error" },
  },
  // `in` also finds the names of the object prototype, so a field named `constructor` is found where there is none.
  {
    files: ["**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "BinaryExpression[operator='in']",
          message:
            "Use Object.hasOwn: `in` also finds the object prototype's names.",
        },
      ],
    },
  },
]);
