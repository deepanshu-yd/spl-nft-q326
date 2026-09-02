import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import wallet from "../../devnet-wallet.json";
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { fetchAsset, mplCore, transfer } from "@metaplex-foundation/mpl-core";
import { base58 } from "@metaplex-foundation/umi/serializers";

const umi = createUmi(
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
);

const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(wallet));
const signer = createSignerFromKeypair(umi, keypair);
umi.use(signerIdentity(signer));
umi.use(mplCore());

const assetId = publicKey("3h1ofrenGXStorpdomnho9NBDoyFr6n2i1uxGRks3yr2");
const newOwner = publicKey("HJURtDYNxuS7wLtDMqQWYV5rjN25edf7bghruXZzEAv");

(async () => {
  try {
    const before = await fetchAsset(umi, assetId);
    console.log("owner before", before.owner);

    const tx = await transfer(umi, {
      asset: before,
      newOwner,
    }).sendAndConfirm(umi);

    const signature = base58.deserialize(tx.signature)[0];
    const after = await fetchAsset(umi, assetId);
    console.log("owner after", after.owner);
    console.log("update authority still", after.updateAuthority);
    console.log("signature", signature);
  } catch (e) {
    console.log("error", e);
  }
})();
