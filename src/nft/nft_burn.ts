import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import wallet from "../../devnet-wallet.json";
import {
  createSignerFromKeypair,
  generateSigner,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { burn, create, fetchAsset, mplCore } from "@metaplex-foundation/mpl-core";
import { base58 } from "@metaplex-foundation/umi/serializers";

const umi = createUmi(
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
);

const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(wallet));
const signer = createSignerFromKeypair(umi, keypair);
umi.use(signerIdentity(signer));
umi.use(mplCore());

const confirm = { confirm: { commitment: "confirmed" as const } };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForAsset(id: Parameters<typeof fetchAsset>[1]) {
  let lastError: unknown;
  for (let i = 0; i < 20; i++) {
    try {
      return await fetchAsset(umi, id);
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw lastError;
}

(async () => {
  try {
    // Mint a spare Core asset so the showcase NFT (DeEvil) is not destroyed.
    const asset = generateSigner(umi);
    await create(umi, {
      asset,
      name: "DeEvil Burn Target",
      uri: "https://example.com/burn-me.json",
    }).sendAndConfirm(umi, confirm);
    console.log("burn target asset:", asset.publicKey);

    const onchain = await waitForAsset(asset.publicKey);
    const before = await umi.rpc.getBalance(signer.publicKey);

    const tx = await burn(umi, { asset: onchain }).sendAndConfirm(umi, confirm);
    const signature = base58.deserialize(tx.signature)[0];

    let after = await umi.rpc.getBalance(signer.publicKey);
    for (let i = 0; i < 15 && after.basisPoints <= before.basisPoints; i++) {
      await sleep(500);
      after = await umi.rpc.getBalance(signer.publicKey);
    }

    console.log("lamports before", before.basisPoints.toString());
    console.log("lamports after ", after.basisPoints.toString());
    console.log(
      "reclaimed (minus tx fee)",
      (after.basisPoints - before.basisPoints).toString(),
    );
    console.log("signature", signature);
    console.log(
      `explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    );
  } catch (e) {
    console.log("error", e);
  }
})();
