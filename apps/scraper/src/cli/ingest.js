#!/usr/bin/env node
const { runCli } = require('./discover');

runCli(process.argv.slice(2)).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
