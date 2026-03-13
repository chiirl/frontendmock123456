#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

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
      'Missing playwright dependency. Run: npm i -D playwright && npx playwright install chromium'
    );
  }

  const email = getArg('--email', process.env.MEETUP_EMAIL || '');
  const password = getArg('--password', process.env.MEETUP_PASSWORD || '');
  const statePath = getArg(
    '--state',
    path.resolve(process.cwd(), '.auth', 'meetup-state.json')
  );

  await ensureDir(path.dirname(statePath));

  const browser = await chromium.launch({
    headless: false,
    slowMo: 60
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Opening Meetup login in a headed browser...');
  await page.goto('https://www.meetup.com/login/', { waitUntil: 'domcontentloaded' });

  if (email) {
    await page.locator('input[data-testid="email"]').fill(email);
  }
  if (password) {
    await page.locator('input[data-testid="current-password"]').fill(password);
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  console.log('');
  console.log('Complete login manually in the browser (captcha/MFA as needed).');
  console.log('When you can see Meetup as logged in, come back here and press Enter.');
  await rl.question('Press Enter to capture session state... ');
  rl.close();

  await context.storageState({ path: statePath });
  console.log(`Saved Meetup session state to: ${statePath}`);
  await browser.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

