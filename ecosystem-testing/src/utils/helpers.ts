import BN from "bn.js";
import { Connection, TransactionSignature, Commitment } from "@solana/web3.js";

export function writeUint32LE(
  value: number,
  buffer: Buffer = Buffer.alloc(4)
): Buffer {
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

export function writeBigUint64LE(
  value: string | number,
  buffer: Buffer = Buffer.alloc(8)
): Buffer {
  const bn = new BN(value);
  bn.toArrayLike(Buffer, "le", 8).copy(buffer);
  return buffer;
}

export function writeUint16LE(
  value: number,
  buffer: Buffer = Buffer.alloc(2)
): Buffer {
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendAndConfirmTransactionWithRetry(
  connection: Connection,
  transaction: Buffer,
  options: {
    skipPreflight?: boolean;
    preflightCommitment?: Commitment;
    maxRetries?: number;
    commitment?: Commitment;
    fastMode?: boolean;
  } = {}
): Promise<TransactionSignature> {
  const {
    skipPreflight = false,
    preflightCommitment = "confirmed",
    maxRetries = 5,
    commitment = "confirmed",
    fastMode = false,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Tx (attempt ${attempt}/${maxRetries})`);

      const signature = await connection.sendRawTransaction(transaction, {
        skipPreflight,
        preflightCommitment,
        maxRetries: 1,
      });

      console.log(`Tx sent ${signature}`);

      await waitForConfirmationWithRetry(
        connection,
        signature,
        commitment,
        fastMode ? 3 : 8
      );

      console.log(`Tx confirmed ${signature}`);
      return signature;
    } catch (error: any) {
      lastError = error;
      console.warn(`Attempt ${attempt} failed \n`, error.message);

      if (shouldNotRetry(error)) {
        throw error;
      }

      if (attempt < maxRetries) {
        const delay = fastMode
          ? Math.min(1000 * attempt, 3000)
          : Math.min(2000 * Math.pow(2, attempt - 1), 15000);
        console.log(`Waiting ${delay}ms`);
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `Tx failed after ${maxRetries} tries. Last error: ${lastError?.message}`
  );
}

function shouldNotRetry(error: any): boolean {
  const message = error.message?.toLowerCase() || "";

  /**
   * CLI won't retry calls to RPC if error code means that tx won't go through anyway
   */
  const nonRetryableErrors = [
    "insufficient funds",
    "blockhash not found",
    "transaction too large",
    "invalid transaction",
    "incorrect program id",
    "account not found",
    "invalid account data",
    "already processed",
  ];

  return nonRetryableErrors.some((errorType) => message.includes(errorType));
}

export async function waitForConfirmationWithRetry(
  connection: Connection,
  signature: TransactionSignature,
  commitment: Commitment = "confirmed",
  maxAttempts: number = 10
): Promise<void> {
  console.log("Confirming tx");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const status = await connection.getSignatureStatus(signature);
      if (
        status.value?.confirmationStatus === "confirmed" ||
        status.value?.confirmationStatus === "finalized"
      ) {
        console.log(
          `Tx already confirmed with status: ${status.value.confirmationStatus}`
        );
        return;
      }

      const { blockhash, lastValidBlockHeight } =
        await getLatestBlockhashWithRetry(connection);

      console.log(
        `Try ${attempt}/${maxAttempts} - Block - ${lastValidBlockHeight}`
      );

      const confirmationPromise = connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        commitment
      );

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Confirmation timeout")), 45000);
      });

      const confirmation = await Promise.race([
        confirmationPromise,
        timeoutPromise,
      ]);

      if (confirmation.value.err) {
        throw new Error(`Tx error: ${JSON.stringify(confirmation.value.err)}`);
      }

      console.log(`Tx confirmed on try ${attempt}`);
      return;
    } catch (error: any) {
      console.warn(`Confirmation try ${attempt} failed:`, error.message);

      if (attempt === maxAttempts) {
        try {
          const finalStatus = await connection.getSignatureStatus(signature);
          if (finalStatus.value?.confirmationStatus) {
            console.log(`Status: ${finalStatus.value.confirmationStatus}`);
            if (
              finalStatus.value.confirmationStatus === "confirmed" ||
              finalStatus.value.confirmationStatus === "finalized"
            ) {
              console.log(`Tx confirmed but there was error`);
              return;
            }
          }
        } catch (statusError) {
          // Ignore status check errors
        }
        throw new Error(
          `Failed after ${maxAttempts} tries \n ${error.message}`
        );
      }

      const delay = Math.min(3000 * attempt, 10000);
      console.log(`Waiting ${delay}ms`);
      await sleep(delay);
    }
  }
}

// ToDo - remove
export async function waitForConfirmation(
  connection: Connection,
  signature: TransactionSignature,
  commitment: Commitment = "confirmed"
): Promise<void> {
  return waitForConfirmationWithRetry(connection, signature, commitment);
}

async function getLatestBlockhashWithRetry(
  connection: Connection,
  maxRetries: number = 5
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      return await connection.getLatestBlockhash("confirmed");
    } catch (error: any) {
      if (error.message?.includes("429") && i < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, i), 8000);
        console.log(`Retry in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Failed to get latest blockhash");
}
