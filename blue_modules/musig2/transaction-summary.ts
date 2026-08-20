import * as bitcoin from 'bitcoinjs-lib';
import { Psbt } from 'bitcoinjs-lib';

export type MuSig2TransactionRecipient = {
  address: string;
  valueSats: bigint;
};

export type MuSig2TransactionSummary = {
  recipients: MuSig2TransactionRecipient[];
  amountSats: bigint;
  feeSats: bigint;
  inputSats: bigint;
  outputSats: bigint;
};

function isInternalChangeOutput(psbt: Psbt, outputIndex: number): boolean {
  const derivations = psbt.data.outputs[outputIndex]?.tapBip32Derivation ?? [];
  return derivations.some(derivation => /^m\/1\/[0-9]+$/.test(derivation.path));
}

function outputAddress(script: Uint8Array): string {
  try {
    return bitcoin.address.fromOutputScript(script);
  } catch {
    return 'Non-address output';
  }
}

/**
 * Builds the human-reviewable transaction summary from the exact unsigned
 * transaction and witness UTXOs that MuSig2 will sign. Change is identified
 * by the aggregate wallet's BIP328 internal branch (m/1/index). External
 * self-sends on m/0/index therefore remain visible as destinations.
 */
export function getMuSig2TransactionSummary(psbt: Psbt): MuSig2TransactionSummary {
  const transaction = bitcoin.Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer());

  let inputSats = 0n;
  psbt.data.inputs.forEach((input, inputIndex) => {
    if (!input.witnessUtxo) {
      throw new Error(`MuSig2 transaction summary requires witness UTXO data for input ${inputIndex}`);
    }
    inputSats += input.witnessUtxo.value;
  });

  const outputSats = transaction.outs.reduce((total, output) => total + output.value, 0n);
  if (inputSats < outputSats) throw new Error('MuSig2 transaction outputs exceed the known input value');

  const recipients = transaction.outs
    .map((output, outputIndex) => ({
      address: outputAddress(output.script),
      valueSats: output.value,
      isChange: isInternalChangeOutput(psbt, outputIndex),
    }))
    .filter(output => !output.isChange)
    .map(({ address, valueSats }) => ({ address, valueSats }));

  return {
    recipients,
    amountSats: recipients.reduce((total, recipient) => total + recipient.valueSats, 0n),
    feeSats: inputSats - outputSats,
    inputSats,
    outputSats,
  };
}

export function formatMuSig2Btc(valueSats: bigint): string {
  const satsPerBitcoin = 100_000_000n;
  const whole = valueSats / satsPerBitcoin;
  const fractional = (valueSats % satsPerBitcoin).toString().padStart(8, '0').replace(/0+$/, '');
  return `${whole}${fractional ? `.${fractional}` : ''} BTC`;
}

export function formatMuSig2Sats(valueSats: bigint): string {
  return `${valueSats.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')} sats`;
}
