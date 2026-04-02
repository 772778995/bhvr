/**
 * Standalone auth script — run this to open Chrome and log in to Google.
 * Usage: bun run src/browser/auth-setup.ts
 */

import { setupAuth, getAuthStatus } from "./auth";

async function main() {
  console.log("=== NotebookLM Auth Setup ===\n");

  const status = getAuthStatus();
  console.log("Current status:", status);

  if (status.authenticated) {
    console.log("\nAlready authenticated! State file age:", status.stateFileAge?.toFixed(1), "days");
    console.log("If you want to re-authenticate, delete data/browser_state/ and run again.");
    return;
  }

  console.log("\nOpening Chrome browser...");
  console.log("Please log in to your Google account in the browser window.");
  console.log("The script will wait up to 10 minutes.\n");

  const success = await setupAuth();

  if (success) {
    console.log("\n✓ Authentication successful! Session saved.");
    console.log("You can now start the server and use the research API.");
  } else {
    console.log("\n✗ Authentication failed or timed out.");
    console.log("Please try again.");
  }
}

main().catch(console.error);
