import assert from 'assert';

import {
  MUSIG2_NUNCHUK_RESERVED_ESCROW_ACCOUNT_INDEX,
  getMuSig2SignerDerivationPath,
  parseMuSig2SignerDerivationPath,
} from '../../blue_modules/musig2/vault';

describe('MuSig2 Nunchuk BIP87 account rules', () => {
  it('rejects Nunchuk escrow account 9999 for MuSig2 vault signers', () => {
    assert.strictEqual(MUSIG2_NUNCHUK_RESERVED_ESCROW_ACCOUNT_INDEX, 9999);
    assert.throws(
      () => getMuSig2SignerDerivationPath(MUSIG2_NUNCHUK_RESERVED_ESCROW_ACCOUNT_INDEX),
      /reserved by Nunchuk for escrow wallets/,
    );
    assert.throws(
      () => parseMuSig2SignerDerivationPath("m/87'/0'/9999'"),
      /reserved by Nunchuk for escrow wallets/,
    );
  });
});
