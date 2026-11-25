import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Inspect tracked source only. Report locations/rules, never secret values.
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const findings = [];
const forbidden = /(^|\/)(?:node_modules|dist|\.next|\.wrangler|\.sites-runtime|\.codex-attachments|outputs|work)\/|(^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?)$|\.(?:pem|key|p12|pfx|keystore|sqlite3?|db|tgz|tar\.gz|log)$/i;
const patterns = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["kalshi-runtime-value", /^(?:export[ \t]+)?KALSHI_(?:API_KEY_ID|PRIVATE_KEY_PEM)[ \t]*=[ \t]*[^\s#]+/m],
];
for (const file of files) {
  if (file !== ".env.example" && forbidden.test(file)) findings.push({ file, rule: "private-or-generated-file" });
  const contents = readFileSync(file, "utf8");
  for (const [rule, pattern] of patterns) if (pattern.test(contents)) findings.push({ file, rule });
}
const hosting = JSON.parse(readFileSync(".openai/hosting.json", "utf8"));
if (hosting.project_id) findings.push({ file: ".openai/hosting.json", rule: "private-deployment-identity" });
if (findings.length) {
  console.error(JSON.stringify({ ok: false, findings }, null, 2));
  process.exitCode = 1;
} else console.log(`Public source guard passed (${files.length} tracked files).`);
