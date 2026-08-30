import { createVertex } from '@ai-sdk/google-vertex';

// Instantiate your custom provider manually passing the strings
export const vertex = createVertex({
  project: process.env.GOOGLE_VERTEX_PROJECT_ID,
  location: process.env.GOOGLE_VERTEX_LOCATION, // Multi-region endpoint for failover/load balancing
  googleAuthOptions: {
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'), // Fixes multiline string issues in envs
    },
  },
});
