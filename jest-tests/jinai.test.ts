import { describe, it, beforeAll, expect } from "@jest/globals";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { Program } from "@coral-xyz/anchor";
import { JinaiHere } from "../target/types/jinai_here";

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
});
