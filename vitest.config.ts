// The e2e test's fixture repos, under .e2e/, hold test files of their own: they are its data, never this repo's tests.
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, ".e2e/**"] },
});
