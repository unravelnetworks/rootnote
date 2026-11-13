// Builds the test-only budget variant (dist-test/rootnote-test-budget.html, project limit 25 MiB)
// used by the budget and recovery tests. Never released; see scripts/build.mjs.
process.env.TEST_BUDGET_BYTES = '26214400';
await import('./build.mjs');
