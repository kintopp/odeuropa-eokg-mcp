import { defineRailway, project, service } from "railway/iac";

// The project is shared with other repos' services; the partial limits this file to its own.
export const partial = "odeuropa-eokg-mcp";

export default defineRailway(() => {
  const mcp = service("odeuropa-eokg-mcp", {
    start: "node src/http.js",
    healthcheck: "/health",
    replicas: { "europe-west4-drams3a": 1 },
  });
  return project("endearing-warmth", { resources: [mcp] });
});
