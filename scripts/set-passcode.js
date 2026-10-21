'use strict';

const readline = require('node:readline');
const auth = require('../lib/auth');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log('Set the 6-digit portal passcode.');
  console.log('Only a salted scrypt hash is stored - never the passcode itself.\n');

  const fromArg = process.argv[2];
  if (fromArg) {
    auth.setPasscode(fromArg);
    console.log('Passcode saved (hashed) to config/auth.json');
    rl.close();
    return;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const passcode = (await ask('New 6-digit passcode: ')).trim();
    if (!/^\d{6}$/.test(passcode)) {
      console.log('Invalid. Use exactly 6 digits.\n');
      continue;
    }
    const confirm = (await ask('Confirm passcode: ')).trim();
    if (confirm !== passcode) {
      console.log('Mismatch. Try again.\n');
      continue;
    }
    auth.setPasscode(passcode);
    console.log('\nPasscode saved (hashed) to config/auth.json');
    console.log('Restart the server if it is running: npm start');
    rl.close();
    return;
  }
  console.error('\nToo many attempts.');
  rl.close();
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  rl.close();
  process.exit(1);
});
