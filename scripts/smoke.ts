/**
 * Release smoke test against a deployed API (and web app). Calls no AI provider.
 *
 *   pnpm smoke --api https://api.example.com --web https://app.example.com
 *   pnpm smoke --api https://api.example.com --commit <sha> --wait 900
 *
 * SMOKE_API_URL and SMOKE_WEB_ORIGIN can be used instead of the flags.
 */
import { runSmoke, waitForCommit } from '../apps/api/src/ops/smoke.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const apiUrl = flag('--api') ?? process.env.SMOKE_API_URL;
const webOrigin = flag('--web') ?? process.env.SMOKE_WEB_ORIGIN;
const commit = flag('--commit');
const waitSeconds = Number(flag('--wait') ?? 0);

if (!apiUrl) {
  console.error(
    'Usage: pnpm smoke --api https://api.example.com [--web https://app.example.com] [--commit <sha> --wait <seconds>]',
  );
  process.exit(1);
}

if (commit && waitSeconds > 0) {
  console.log(`Waiting up to ${waitSeconds}s for ${apiUrl} to serve ${commit.slice(0, 7)}.`);
  const live = await waitForCommit({ apiUrl, commit, timeoutMs: waitSeconds * 1000 });
  if (!live) {
    console.error('The new build did not come up in time. Check the Render deploy log.');
    process.exit(1);
  }
}

const results = await runSmoke({
  apiUrl,
  ...(webOrigin ? { webOrigin } : {}),
  ...(commit ? { expectCommit: commit } : {}),
});

for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name.padEnd(28)} ${result.detail}`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(failed > 0 ? `${failed} check(s) failed.` : `All ${results.length} checks passed.`);
process.exitCode = failed > 0 ? 1 : 0;
