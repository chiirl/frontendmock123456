#!/usr/bin/env node
const { runCli } = require('./discover');

async function main() {
  const args = process.argv.slice(2);
  const nextArgs = args.includes('--dry-run') ? args : ['--dry-run', ...args];
  await runCli(nextArgs);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
