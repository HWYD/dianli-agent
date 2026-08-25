import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextCoreWebVitals,
  {
    ignores: [".next/**", "data/rag-index.json", "playwright-report/**", "test-results/**"],
  },
];

export default config;
