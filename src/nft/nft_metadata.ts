import {
  createSignerFromKeypair,
  signerIdentity,
} from "@metaplex-foundation/umi";
import wallet from "../../devnet-wallet.json";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";

const umi = createUmi(
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
);

const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(wallet));
const signer = createSignerFromKeypair(umi, keypair);

umi.use(
  irysUploader({
    address: "https://devnet.irys.xyz/",
  }),
);

umi.use(signerIdentity(signer));

(async () => {
  try {
    //change the image uri to your image uri obtained from nft_image.ts
    const image =
      "https://gateway.irys.xyz/AvNxi1wpjBG6iw2yP7o8uRuLFaXXbFYy3er4rwWVojgL";

    const metadata = {
      name: "DeEvil",
      description: "Assignment NFT minted with MPL Core on devnet.",
      image,
      attributes: [
        { trait_type: "cohort", value: "q326" },
        { trait_type: "kind", value: "core-asset" },
      ],
      properties: {
        files: [{ uri: image, type: "image/jpeg" }],
        category: "image",
      },
    };

    const myUri = await umi.uploader.uploadJson(metadata);
    console.log(`metadata uri: ${myUri}`);

  } catch (error) {
    console.log("error", error);
  }
})();
