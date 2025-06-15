import { describe, it, beforeAll, expect } from "@jest/globals";
import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { Program } from "@coral-xyz/anchor";
import { JinaiHere } from "../target/types/jinai_here";
import { BN } from "bn.js";

describe("JinAI pool creation", () => {
  let context: any;
  let provider: BankrunProvider;
  let program: Program<JinaiHere>;
  let payer: Keypair;
  let playerKeypair: Keypair;

  beforeAll(async () => {
    const IDL = require("../target/idl/jinai_here.json");
    const PROGRAM_ID = new PublicKey(IDL.address);

    context = await startAnchor("./", [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);

    payer = context.payer;
    playerKeypair = Keypair.generate();

    // Fund playerKeypair from payer
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: playerKeypair.publicKey,
        lamports: 2 * LAMPORTS_PER_SOL, // or any amount you need
      })
    );
    await provider.sendAndConfirm(tx, [payer]);

    program = new anchor.Program<JinaiHere>(IDL, provider);
  });

  it("should initialize global state correctly", async () => {
    try {
      const feeBasisPoints = 250;
      const treasury = Keypair.generate();

      const [globalStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("global-state")],
        program.programId
      );

      const tx = await program.methods
        .appointPool(feeBasisPoints)
        .accountsPartial({
          globalState: globalStatePda,
          authority: payer.publicKey,
          treasury: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      console.log("Appoint pool transaction signature:", tx);

      const globalStateAccount = await program.account.globalState.fetch(
        globalStatePda
      );

      expect(globalStateAccount.authority.toString()).toBe(
        payer.publicKey.toString()
      );
      expect(globalStateAccount.poolCount.toString()).toBe("0");
      expect(globalStateAccount.treasury.toString()).toBe(
        treasury.publicKey.toString()
      );
      expect(globalStateAccount.feeBasisPoints).toBe(feeBasisPoints);
      expect(globalStateAccount.bump).toBeGreaterThan(0);

      console.log("Global state initialized successfully:", {
        authority: globalStateAccount.authority.toString(),
        poolCount: globalStateAccount.poolCount,
        treasury: globalStateAccount.treasury.toString(),
        feeBasisPoints: globalStateAccount.feeBasisPoints,
        bump: globalStateAccount.bump,
      });
    } catch (error) {
      console.error("Test failed with error:", error);
      throw error;
    }
  });

  it("should create a pool correctly", async () => {
    try {
      const [globalStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("global-state")],
        program.programId
      );
      // Fetch the current global state to get the pool count for PDA derivation
      const globalStateAccount = await program.account.globalState.fetch(
        globalStatePda
      );

      const poolCount = Number(globalStateAccount.poolCount);
      const [poolPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("pool"),
          Buffer.from(Uint8Array.of(...new BN(poolCount).toArray("le", 8))),
        ],
        program.programId
      );

      const minDeposit = new anchor.BN(1000);
      const endTime = new anchor.BN(Date.now() / 1000 + 3600); // 1 hour from now
      const prizeDistribution = [30, 30, 20, 10];

      const tx = await program.methods
        .createPool(minDeposit, endTime, prizeDistribution)
        .accountsPartial({
          globalState: globalStatePda,
          pool: poolPda,
          creator: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();

      console.log("Create pool transaction signature:", tx);

      const poolAccount = await program.account.pool.fetch(poolPda);
      const globalStateAfter = await program.account.globalState.fetch(
        globalStatePda
      );

      expect(poolAccount.poolId.toString()).toBe(poolCount.toString());
      expect(poolAccount.creator.toString()).toBe(payer.publicKey.toString());
      expect(Number(poolAccount.totalAmount)).toBe(0);
      expect(poolAccount.status).toEqual({ open: {} }); // Assuming PoolStatus::Open = 0
      expect(Number(poolAccount.minDeposit)).toBe(Number(minDeposit));
      expect(Number(poolAccount.currentPlayers)).toBe(0);
      expect(Number(poolAccount.maxPlayers)).toBe(4);
      expect(Number(poolAccount.endTime)).toBe(Number(endTime));
      expect(poolAccount.prizeDistribution).toEqual(prizeDistribution);
      expect(Number(poolAccount.feeAmount)).toBe(0);
      expect(poolAccount.playerAccounts.length).toBe(4);

      console.log("Pool created successfully:", {
        poolId: poolAccount.poolId,
        creator: poolAccount.creator.toString(),
        minDeposit: poolAccount.minDeposit.toNumber(),
        endTime: poolAccount.endTime.toNumber(),
        prizeDistribution: poolAccount.prizeDistribution,
        updatedPoolCount: globalStateAfter.poolCount,
      });
    } catch (error) {
      console.error("Test failed with error:", error);
      throw error;
    }
  });

  it("should successfully allow 4 players to join a pool", async () => {
    try {
      const poolId = "0";
      const depositAmount = new BN(1 * LAMPORTS_PER_SOL); // 1 SOL in lamports
      const numberOfPlayers = 4;

      // Create keypairs for all players
      const playerKeypairs = Array.from({ length: numberOfPlayers }, () =>
        Keypair.generate()
      );

      // Derive pool PDA
      const [poolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), new BN(poolId).toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      // Derive pool vault PDA
      const [poolVaultPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("pool-vault"),
          new BN(poolId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      // Get initial pool state
      const poolAccountBefore = await program.account.pool.fetch(poolPda);
      const initialPlayerCount = poolAccountBefore.currentPlayers;
      const initialTotalAmount = poolAccountBefore.totalAmount;

      console.log("Initial pool state:");
      console.log(
        `Players: ${initialPlayerCount}/${poolAccountBefore.maxPlayers}`
      );
      console.log(`Total amount: ${initialTotalAmount.toString()} lamports`);

      // Fund all player accounts
      console.log("Funding player accounts...");
      for (let i = 0; i < numberOfPlayers; i++) {
        const fundTx = new anchor.web3.Transaction().add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: playerKeypairs[i].publicKey,
            lamports: 2 * LAMPORTS_PER_SOL,
          })
        );
        await provider.sendAndConfirm(fundTx, [payer]);
        console.log(
          `✅ Funded player ${i + 1}: ${playerKeypairs[i].publicKey.toString()}`
        );
      }

      // Have each player join the pool
      const playerPdas = [];

      for (let i = 0; i < numberOfPlayers; i++) {
        console.log(`\n--- Player ${i + 1} joining pool ---`);

        // Derive player PDA
        const [playerPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("player"),
            new BN(poolId).toArrayLike(Buffer, "le", 8),
            playerKeypairs[i].publicKey.toBuffer(),
          ],
          program.programId
        );
        playerPdas.push(playerPda);

        // Get pool state before this player joins
        const poolAccountBeforeJoin = await program.account.pool.fetch(poolPda);
        const playersBeforeJoin = poolAccountBeforeJoin.currentPlayers;
        const totalAmountBeforeJoin = poolAccountBeforeJoin.totalAmount;

        // Execute join_pool instruction
        const tx = await program.methods
          .joinPool(depositAmount)
          .accountsPartial({
            pool: poolPda,
            player: playerPda,
            playerAuthority: playerKeypairs[i].publicKey,
            poolVault: poolVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([playerKeypairs[i]])
          .rpc();

        console.log(`Player ${i + 1} join transaction signature:`, tx);

        // Verify pool state updates after this player joins
        const poolAccountAfterJoin = await program.account.pool.fetch(poolPda);
        expect(Number(poolAccountAfterJoin.currentPlayers)).toBe(
          Number(playersBeforeJoin) + 1
        );
        expect(poolAccountAfterJoin.totalAmount.toString()).toBe(
          totalAmountBeforeJoin.add(depositAmount).toString()
        );
        expect(
          poolAccountAfterJoin.playerAccounts[
            Number(playersBeforeJoin)
          ].toString()
        ).toBe(playerPda.toString());

        // Verify player account creation and initialization
        const playerAccount = await program.account.player.fetch(playerPda);
        expect(playerAccount.player.toString()).toBe(
          playerKeypairs[i].publicKey.toString()
        );
        expect(playerAccount.poolId.toString()).toBe(poolId.toString());
        expect(playerAccount.depositAmount.toString()).toBe(
          depositAmount.toString()
        );
        expect(playerAccount.hasClaimed).toBe(false);
        expect(playerAccount.rank).toBe(0);
        expect(playerAccount.prizeAmount.toString()).toBe("0");

        console.log(`✅ Player ${i + 1} successfully joined pool`);
        console.log(
          `Pool players: ${poolAccountAfterJoin.currentPlayers}/${poolAccountAfterJoin.maxPlayers}`
        );
        console.log(
          `Total pool amount: ${poolAccountAfterJoin.totalAmount.toString()} lamports (${
            Number(poolAccountAfterJoin.totalAmount) / 1_000_000_000
          } SOL)`
        );
      }

      // Final verification - check that all 4 players joined successfully
      const finalPoolAccount = await program.account.pool.fetch(poolPda);
      const expectedPlayerCount = Number(initialPlayerCount) + numberOfPlayers;

      expect(Number(finalPoolAccount.currentPlayers)).toBe(expectedPlayerCount);
      expect(finalPoolAccount.totalAmount.toString()).toBe(
        initialTotalAmount
          .add(depositAmount.mul(new BN(numberOfPlayers)))
          .toString()
      );

      // If pool is now full, check status change
      if (
        Number(finalPoolAccount.currentPlayers) ===
        Number(finalPoolAccount.maxPlayers)
      ) {
        expect(finalPoolAccount.status).toStrictEqual({ inProgress: {} });
        console.log("🎉 Pool is now full and status changed to 'inProgress'");
      }

      // Verify all player accounts exist and are correctly initialized
      console.log("\n--- Verifying all player accounts ---");
      for (let i = 0; i < numberOfPlayers; i++) {
        const playerAccount = await program.account.player.fetch(playerPdas[i]);
        expect(playerAccount.player.toString()).toBe(
          playerKeypairs[i].publicKey.toString()
        );
        expect(playerAccount.poolId.toString()).toBe(poolId.toString());
        expect(playerAccount.depositAmount.toString()).toBe(
          depositAmount.toString()
        );
        console.log(`✅ Player ${i + 1} account verified`);
      }

      console.log("\n🎉 All 4 players successfully joined the pool!");
      console.log(`Final pool state:`);
      console.log(
        `Players: ${finalPoolAccount.currentPlayers}/${finalPoolAccount.maxPlayers}`
      );
      console.log(
        `Total amount: ${finalPoolAccount.totalAmount.toString()} lamports (${
          Number(finalPoolAccount.totalAmount) / 1_000_000_000
        } SOL)`
      );
    } catch (error) {
      console.error("Test failed with error:", error);
      throw error;
    }
  });
});
