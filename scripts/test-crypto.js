'use strict';

const VaultCrypto = require('../vault-crypto.js');

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
}

(async () => {
  const secret = 'github_pat_dummy_token_value_123';

  const vault = await VaultCrypto.encryptSecret('800140', secret);
  check('encrypt returns salt/iv/ct', Boolean(vault.salt && vault.iv && vault.ct));
  check('stored blob contains no plaintext token', !vault.ct.includes(secret) && JSON.stringify(vault).indexOf('github_pat') === -1);

  const back = await VaultCrypto.decryptSecret(vault, '800140');
  check('roundtrip decrypt returns original', back === secret);

  const wrong = await VaultCrypto.decryptSecret(vault, '800141');
  check('wrong passcode returns null (GCM auth fails)', wrong === null);

  const tampered = { ...vault, ct: vault.ct.slice(0, -4) + 'AAAA' };
  const tamperResult = await VaultCrypto.decryptSecret(tampered, '800140');
  check('tampered ciphertext rejected', tamperResult === null);

  const large = 'x'.repeat(5 * 1024 * 1024);
  const bigVault = await VaultCrypto.encryptSecret('123456', large);
  const bigBack = await VaultCrypto.decryptSecret(bigVault, '123456');
  check('5MB payload roundtrip', bigBack === large);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
