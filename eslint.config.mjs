import nextVitals from "eslint-config-next/core-web-vitals";
const config = [
  ...nextVitals,
  { ignores: ["dist/**", ".tools/**", "tools/**", "coverage/**", "next-env.d.ts"] },
  // Preserve existing effect synchronization and full-page workspace/auth
  // navigation. These new advisory rules would require unrelated UI rewrites.
  { rules: { "react-hooks/set-state-in-effect": "off", "@next/next/no-location-assign-relative-destination": "off" } },
];
export default config;
