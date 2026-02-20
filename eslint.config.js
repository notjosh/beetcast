import eslintConfigPrettier from "eslint-config-prettier";
import perfectionist from "eslint-plugin-perfectionist";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  perfectionist.configs["recommended-natural"],
  eslintConfigPrettier,
  {
    files: ["frontend/src/components/ui/**"],
    rules: {
      "perfectionist/sort-exports": "off",
      "perfectionist/sort-jsx-props": "off",
      "perfectionist/sort-modules": "off",
      "perfectionist/sort-named-exports": "off",
      "perfectionist/sort-named-imports": "off",
      "perfectionist/sort-objects": "off",
    },
  },
];
