#!/usr/bin/env node
// Lê o .env e faz upload dos secrets sensíveis para o Cloudflare Workers via wrangler secret bulk
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";

const SECRETS = ["ANTHROPIC_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

const env = readFileSync(".env", "utf-8");
const parsed = Object.fromEntries(
  env
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [key, ...rest] = line.split("=");
      return [key.trim(), rest.join("=").trim().replace(/^"|"$/g, "")];
    })
    .filter(([key]) => SECRETS.includes(key))
);

if (Object.keys(parsed).length === 0) {
  console.error("Nenhum secret encontrado no .env:", SECRETS);
  process.exit(1);
}

const tmpFile = ".secrets.tmp.json";
writeFileSync(tmpFile, JSON.stringify(parsed, null, 2));

try {
  console.log("Enviando secrets:", Object.keys(parsed).join(", "));
  execSync(`npx wrangler secret bulk ${tmpFile}`, { stdio: "inherit" });
  console.log("✓ Secrets enviados com sucesso.");
} finally {
  unlinkSync(tmpFile);
}
