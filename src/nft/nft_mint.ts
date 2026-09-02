import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import wallet from "../../devnet-wallet.json";
import {
  createSignerFromKeypair,
  generateSigner,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { create, mplCore } from "@metaplex-foundation/mpl-core";
import { base58 } from "@metaplex-foundation/umi/serializers";

const umi = createUmi(
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
);

const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(wallet));
const signer = createSignerFromKeypair(umi, keypair);

umi.use(signerIdentity(signer));

umi.use(mplCore());

(async () => {
  try {
    const metadataUri =
      "https://gateway.irys.xyz/5KAJKWgMZa1VHY1CKbAqX1AYcoKN9g4PHeGYDrD6GwDo".trim();
    const asset = generateSigner(umi);

    const tx = await create(umi, {
      asset,
      name: "DeEvil",
      uri: metadataUri,
    }).sendAndConfirm(umi);

    const signature = base58.deserialize(tx.signature)[0];
    console.log(`signature ${signature} , asset : ${asset.publicKey}`);
    console.log(
      `core explorer: https://core.metaplex.com/explorer/${asset.publicKey}`,
    );
    console.log(
      `solana explorer: https://explorer.solana.com/address/${asset.publicKey}?cluster=devnet`,
    );

  } catch (e) {
    console.log(`errior ${e}`);
  }
})();
