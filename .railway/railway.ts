import { defineRailway, github, project, service } from "railway/iac";

// The project is shared with other repos' services; the partial limits this file to its own.
export const partial = "odeuropa-eokg-mcp";

export default defineRailway(() => {
  const mcp = service("odeuropa-eokg-mcp", {
    source: github("kintopp/odeuropa-eokg-mcp", { branch: "main", checkSuites: false }),
    // Only runtime files redeploy on push; docs, tests, scripts and the skill don't.
    build: { watchPatterns: ["src/**", "package.json", "package-lock.json"] },
    start: "node src/http.js",
    healthcheck: "/health",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { limitOverride: { containers: { cpu: 24, memoryBytes: 1000000000 } } },
  });
  return project("endearing-warmth", { resources: [mcp] });
});
