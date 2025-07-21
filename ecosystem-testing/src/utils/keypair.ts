import { Keypair } from "@solana/web3.js";
import fs from "fs";
import yaml from "yaml";
import path from "path";
import os from "os";

export function loadKeypair(keypairPath: string): Keypair {
  try {
    if (keypairPath.startsWith("~/")) {
      keypairPath = path.join(os.homedir(), keypairPath.slice(2));
    }

    console.log(`Loading keypair from: ${keypairPath}`);

    if (keypairPath.endsWith(".json")) {
      return loadJsonKeypair(keypairPath);
    } else if (keypairPath.endsWith(".yaml") || keypairPath.endsWith(".yml")) {
      return loadYamlKeypair(keypairPath);
    } else {
      throw new Error("Unsupported keypair format. Use .json or .yaml/.yml");
    }
  } catch (error) {
    console.error("Error loading keypair:", (error as Error).message);
    process.exit(1);
  }
}

function loadJsonKeypair(keypairPath: string): Keypair {
  const fileContent = fs.readFileSync(keypairPath, "utf-8");
  let secretKey: Uint8Array;

  try {
    secretKey = Uint8Array.from(JSON.parse(fileContent));
  } catch (e) {
    const jsonContent = JSON.parse(fileContent);
    if (jsonContent.privateKey) {
      secretKey = Uint8Array.from(jsonContent.privateKey);
    } else if (jsonContent.secretKey) {
      secretKey = Uint8Array.from(jsonContent.secretKey);
    } else {
      throw new Error("Keypair file format not recognized");
    }
  }

  const keypair = Keypair.fromSecretKey(secretKey);
  console.log(
    `Loaded keypair with public key: ${keypair.publicKey.toString()}`
  );
  return keypair;
}

// ToDo - remove after adding json
function loadYamlKeypair(keypairPath: string): Keypair {
  const keypairString = yaml.parse(
    fs.readFileSync(keypairPath, "utf-8")
  ).keypair;
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(keypairString))
  );
  console.log(
    `Loaded keypair with public key: ${keypair.publicKey.toString()}`
  );
  return keypair;
}
