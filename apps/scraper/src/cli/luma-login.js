#!/usr/bin/env node
// Open a headed browser so you can log in to Luma manually,
// then saves the session state for reuse by luma-explore.js and chibot.
require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');

function getArg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error(
      'Missing playwright. Run: npm i -D playwright && npx playwright install chromium'
    );
  }

  const statePath = getArg(
    '--state',
    path.resolve(process.cwd(), '.auth', 'luma-state.json')
  );

  await fs.mkdir(path.dirname(statePath), { recursive: true });

  const browser = await chromium.launch({ headless: false, slowMo: 60 });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Opening Luma login in a headed browser...');
  await page.goto('https://luma.com/signin', { waitUntil: 'domcontentloaded' });

  const rl = readline.createInterface({ input: stdin, output: stdout });
  console.log('');
  console.log('Complete login in the browser (enter your email, check for magic link, etc).');
  console.log('Once you can see your Luma feed as logged in, come back here and press Enter.');
  await rl.question('Press Enter to capture session state... ');
  rl.close();

  await context.storageState({ path: statePath });
  console.log(`\nSaved Luma session state to: ${statePath}`);
  await browser.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
