import { createVertex, type GoogleVertexProvider } from "@ai-sdk/google-vertex";

let provider: GoogleVertexProvider | null = null;

function configuredVertex(): GoogleVertexProvider {
  if (provider) return provider;

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!clientEmail || !privateKey) {
    const missing = [
      !clientEmail && "GOOGLE_CLIENT_EMAIL",
      !privateKey && "GOOGLE_PRIVATE_KEY",
    ].filter(Boolean);
    throw new Error(`Google Vertex credentials are missing: ${missing.join(", ")}.`);
  }

  provider = createVertex({
    project: process.env.GOOGLE_VERTEX_PROJECT_ID,
    location: process.env.GOOGLE_VERTEX_LOCATION, // Multi-region endpoint for failover/load balancing
    googleAuthOptions: {
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
    },
  });
  return provider;
}

export function vertex(modelId: Parameters<GoogleVertexProvider>[0]) {
  return configuredVertex()(modelId);
}
