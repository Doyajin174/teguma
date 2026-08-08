// ESLint 10 flat config (명세 020 3장).
// 범위: src/ (package.json lint 스크립트와 일치). 예외 정책은 docs/specs/020-lint-gate.md.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "experiments/", "web/", "stock/", "data/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 예외 정책 (명세 3.1) — 기존 코드 스타일을 전면 재작성하지 않는다:
      // 타입·안전성 규칙만 활성화하고 스타일 규칙은 off.
      "@typescript-eslint/no-explicit-any": "off", // 기존 any 사용 다수 — 점진 정리 대상
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-unused-vars": "off", // TS 규칙으로 대체
    },
  },
);
