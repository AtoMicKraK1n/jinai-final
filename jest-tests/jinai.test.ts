import { describe, it, beforeAll, expect } from "@jest/globals";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
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

  beforeAll(async () => {
    const IDL = require("../target/idl/jinai_here.json");
    const PROGRAM_ID = new PublicKey(IDL.address);

    context = await startAnchor(
      "", // project path or empty string
      [{ name: "jinai_here", programId: PROGRAM_ID }],
      []
    );
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);

    payer = context.payer;

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
});
