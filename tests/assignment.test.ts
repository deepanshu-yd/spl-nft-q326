import { expect } from "chai";
import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  fetchMint,
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstructionAsync,
  getInitializeMintInstruction,
  getMintSize,
  getMintToInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createSignerFromKeypair,
  generateSigner,
  signerIdentity,
} from "@metaplex-foundation/umi";
import {
  burn,
  create,
  fetchAsset,
  mplCore,
  transfer,
  update,
} from "@metaplex-foundation/mpl-core";
import wallet from "../devnet-wallet.json";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const WS_URL = RPC_URL.replace("https://", "wss://").replace("http://", "ws://");
const DECIMALS = 6;
const UNIT = 1_000_000n;

describe("SPL + MPL Core assignment", function () {
  this.timeout(180_000);

  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  let kitSigner: Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>;
  let mintAddress: Awaited<ReturnType<typeof generateKeyPairSigner>>["address"];
  let fromAta: Awaited<ReturnType<typeof findAssociatedTokenPda>>[0];
  let recipient: Awaited<ReturnType<typeof generateKeyPairSigner>>;

  const umi = createUmi(RPC_URL);
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(
    new Uint8Array(wallet),
  );
  const umiSigner = createSignerFromKeypair(umi, umiKeypair);
  umi.use(signerIdentity(umiSigner));
  umi.use(mplCore());

  before(async () => {
    kitSigner = await createKeyPairSignerFromBytes(new Uint8Array(wallet));
    recipient = await generateKeyPairSigner();
  });

  async function sendIxs(
    instructions: Parameters<
      typeof appendTransactionMessageInstructions
    >[0],
  ) {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const msg = createTransactionMessage({ version: 0 });
    const withPayer = setTransactionMessageFeePayerSigner(kitSigner, msg);
    const withLife = setTransactionMessageLifetimeUsingBlockhash(
      latestBlockhash,
      withPayer,
    );
    const txMessage = appendTransactionMessageInstructions(
      instructions,
      withLife,
    );
    const signed = await signTransactionMessageWithSigners(txMessage);
    assertIsTransactionWithBlockhashLifetime(signed);
    await sendAndConfirm(signed, { commitment: "confirmed" });
  }

  describe("Task 1: mint and transfer an SPL token", () => {
    it("creates a mint with 6 decimals and this wallet as mint authority", async () => {
      const mint = await generateKeyPairSigner();
      const space = BigInt(getMintSize());
      const lamports = await rpc
        .getMinimumBalanceForRentExemption(space)
        .send();

      await sendIxs([
        getCreateAccountInstruction({
          payer: kitSigner,
          newAccount: mint,
          lamports,
          space,
          programAddress: TOKEN_PROGRAM_ADDRESS,
        }),
        getInitializeMintInstruction({
          mint: mint.address,
          decimals: DECIMALS,
          mintAuthority: kitSigner.address,
          freezeAuthority: kitSigner.address,
        }),
      ]);

      mintAddress = mint.address;
      const mintAccount = await fetchMint(rpc, mintAddress);
      expect(mintAccount.data.decimals).to.equal(DECIMALS);
      expect(mintAccount.data.supply).to.equal(0n);
    });

    it("creates the ATA and mints 10 tokens", async () => {
      const [ata] = await findAssociatedTokenPda({
        mint: mintAddress,
        owner: kitSigner.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      fromAta = ata;

      await sendIxs([
        await getCreateAssociatedTokenInstructionAsync({
          payer: kitSigner,
          mint: mintAddress,
          owner: kitSigner.address,
        }),
        getMintToInstruction({
          mint: mintAddress,
          token: ata,
          amount: 10n * UNIT,
          mintAuthority: kitSigner,
        }),
      ]);

      const token = await fetchToken(rpc, ata);
      expect(token.data.amount).to.equal(10n * UNIT);
      const mintAccount = await fetchMint(rpc, mintAddress);
      expect(mintAccount.data.supply).to.equal(10n * UNIT);
    });

    it("transfers 1 token to another wallet ATA", async () => {
      const [toAta] = await findAssociatedTokenPda({
        mint: mintAddress,
        owner: recipient.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });

      await sendIxs([
        await getCreateAssociatedTokenInstructionAsync({
          payer: kitSigner,
          mint: mintAddress,
          owner: recipient.address,
        }),
        getTransferCheckedInstruction({
          source: fromAta,
          mint: mintAddress,
          destination: toAta,
          authority: kitSigner,
          amount: 1n * UNIT,
          decimals: DECIMALS,
        }),
      ]);

      const src = await fetchToken(rpc, fromAta);
      const dst = await fetchToken(rpc, toAta);
      expect(src.data.amount).to.equal(9n * UNIT);
      expect(dst.data.amount).to.equal(1n * UNIT);
    });
  });

  describe("Tasks 2-5: MPL Core NFT lifecycle", () => {
    const asset = generateSigner(umi);
    const metadataUri = "https://example.com/assignment-nft.json";
    const confirm = { confirm: { commitment: "confirmed" as const } };

    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    async function waitForAsset(id: typeof asset.publicKey) {
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

    it("mints a Core asset (task 2)", async () => {
      await create(umi, {
        asset,
        name: "Test Core NFT",
        uri: metadataUri,
      }).sendAndConfirm(umi, confirm);

      const onchain = await waitForAsset(asset.publicKey);
      expect(onchain.name).to.equal("Test Core NFT");
      expect(onchain.uri).to.equal(metadataUri);
      expect(onchain.owner).to.equal(umiSigner.publicKey);
    });

    it("updates name and uri as update authority (task 3)", async () => {
      const newUri = "https://example.com/assignment-nft-updated.json";
      const current = await waitForAsset(asset.publicKey);

      await update(umi, {
        asset: current,
        name: "Test Core NFT Updated",
        uri: newUri,
      }).sendAndConfirm(umi, confirm);

      let onchain = await waitForAsset(asset.publicKey);
      for (let i = 0; i < 10 && onchain.name !== "Test Core NFT Updated"; i++) {
        await sleep(400);
        onchain = await waitForAsset(asset.publicKey);
      }
      expect(onchain.name).to.equal("Test Core NFT Updated");
      expect(onchain.uri).to.equal(newUri);
    });

    it("transfers ownership to another wallet (task 4)", async () => {
      const newOwner = generateSigner(umi);
      const current = await waitForAsset(asset.publicKey);

      await transfer(umi, {
        asset: current,
        newOwner: newOwner.publicKey,
      }).sendAndConfirm(umi, confirm);

      let onchain = await waitForAsset(asset.publicKey);
      for (
        let i = 0;
        i < 10 && onchain.owner !== newOwner.publicKey;
        i++
      ) {
        await sleep(400);
        onchain = await waitForAsset(asset.publicKey);
      }
      expect(onchain.owner).to.equal(newOwner.publicKey);
    });

    it("burns a Core asset and reclaims rent (task 5)", async () => {
      const burnable = generateSigner(umi);
      await create(umi, {
        asset: burnable,
        name: "Burn me",
        uri: metadataUri,
      }).sendAndConfirm(umi, confirm);

      const current = await waitForAsset(burnable.publicKey);
      const before = await umi.rpc.getBalance(umiSigner.publicKey);

      await burn(umi, { asset: current }).sendAndConfirm(umi, confirm);

      let after = await umi.rpc.getBalance(umiSigner.publicKey);
      for (
        let i = 0;
        i < 15 && after.basisPoints <= before.basisPoints;
        i++
      ) {
        await sleep(500);
        after = await umi.rpc.getBalance(umiSigner.publicKey);
      }
      expect(Number(after.basisPoints)).to.be.greaterThan(
        Number(before.basisPoints),
      );

      let gone = false;
      for (let i = 0; i < 10; i++) {
        try {
          await fetchAsset(umi, burnable.publicKey);
          await sleep(400);
        } catch {
          gone = true;
          break;
        }
      }
      expect(gone).to.equal(true);
    });
  });
});
