// The test-only budget build (scripts/build-test-budget.mjs): the same app with a 25 MiB project
// limit, so budget and recovery behaviour can be tested on small files. It does NOT show that a
// 256 MiB project works; tests/real-cap.e2e.test.mjs does that on the released build.
import { fileURLToPath } from 'node:url';
export const TEST_BUDGET_DIST = fileURLToPath(new URL('../../dist-test/rootnote-test-budget.html', import.meta.url));
export const TEST_FILE_BYTES = 26214400;
