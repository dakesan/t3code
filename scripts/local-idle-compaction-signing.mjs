/* oxlint-disable t3code/no-global-process-runtime -- Local signing setup is a deployment boundary. */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

const invoke = NodeUtil.promisify(NodeChildProcess.execFile);
const exec = async (command, args) => {
  try {
    return await invoke(command, args);
  } catch (error) {
    // Do not include argv: keychain commands carry the dedicated signing password.
    throw new Error(`${command} failed (${error.code}): ${error.stderr ?? ""}`, { cause: error });
  }
};
const exists = (file) =>
  NodeFSP.access(file).then(
    () => true,
    () => false,
  );

export function identityArguments(identity) {
  if (
    !identity ||
    !/^[A-Fa-f0-9]{40}$/.test(identity.identity) ||
    !NodePath.isAbsolute(identity.keychain)
  )
    throw new Error("A persistent Desktop signing identity must be configured first");
  return ["--sign", identity.identity, "--keychain", identity.keychain, "--timestamp=none"];
}

export async function unlockSigningIdentity(identity) {
  identityArguments(identity);
  const info = await NodeFSP.stat(identity.passwordFile);
  if ((info.mode & 0o077) !== 0) throw new Error("Signing password file must be private");
  const password = (await NodeFSP.readFile(identity.passwordFile, "utf8")).trim();
  await exec("/usr/bin/security", ["unlock-keychain", "-p", password, identity.keychain]);
}

export async function setupSigningIdentity(state) {
  if (NodeOS.platform() !== "darwin") throw new Error("Desktop signing setup is macOS-only");
  const root = NodePath.join(state, "signing");
  await NodeFSP.mkdir(root, { recursive: true, mode: 0o700 });
  await NodeFSP.chmod(root, 0o700);
  const recordFile = NodePath.join(root, "identity.json");
  if (await exists(recordFile)) {
    const record = JSON.parse(await NodeFSP.readFile(recordFile, "utf8"));
    await unlockSigningIdentity(record);
    return record;
  }
  const passwordFile = NodePath.join(root, "keychain-password");
  if (!(await exists(passwordFile)))
    await NodeFSP.writeFile(passwordFile, NodeCrypto.randomBytes(32).toString("hex") + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  const password = (await NodeFSP.readFile(passwordFile, "utf8")).trim();
  const key = NodePath.join(root, "signing-key.pem");
  const cert = NodePath.join(root, "signing-cert.pem");
  const config = NodePath.join(root, "openssl.cnf");
  await NodeFSP.writeFile(
    config,
    "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=T3 Code Local Patch\n[ext]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\nsubjectKeyIdentifier=hash\n",
    { mode: 0o600 },
  );
  if (!(await exists(key)))
    await exec("/usr/bin/openssl", [
      "genrsa",
      "-aes256",
      "-passout",
      `file:${passwordFile}`,
      "-out",
      key,
      "3072",
    ]);
  await NodeFSP.chmod(key, 0o600);
  if (!(await exists(cert)))
    await exec("/usr/bin/openssl", [
      "req",
      "-new",
      "-x509",
      "-sha256",
      "-days",
      "3650",
      "-config",
      config,
      "-key",
      key,
      "-passin",
      `file:${passwordFile}`,
      "-out",
      cert,
    ]);
  const keychain = NodePath.join(root, "T3PatchSigning.keychain-db");
  if (!(await exists(keychain)))
    await exec("/usr/bin/security", ["create-keychain", "-p", password, keychain]);
  const p12 = NodePath.join(root, "signing-identity.p12");
  const p12PasswordFile = NodePath.join(root, "p12-password");
  await NodeFSP.writeFile(p12PasswordFile, password + "\n", { mode: 0o600 });
  await exec("/usr/bin/openssl", [
    "pkcs12",
    "-export",
    "-inkey",
    key,
    "-in",
    cert,
    "-passin",
    `file:${passwordFile}`,
    "-passout",
    `file:${p12PasswordFile}`,
    "-out",
    p12,
  ]);
  await NodeFSP.chmod(p12, 0o600);
  await exec("/usr/bin/security", ["unlock-keychain", "-p", password, keychain]);
  const result = await exec("/usr/bin/openssl", [
    "x509",
    "-in",
    cert,
    "-noout",
    "-fingerprint",
    "-sha1",
  ]);
  const identity = result.stdout.trim().split("=").at(-1).replaceAll(":", "");
  const existing = await exec("/usr/bin/security", [
    "find-identity",
    "-p",
    "codesigning",
    keychain,
  ]);
  if (!existing.stdout.includes(identity))
    await exec("/usr/bin/security", [
      "import",
      p12,
      "-k",
      keychain,
      "-P",
      password,
      "-T",
      "/usr/bin/codesign",
    ]);
  await exec("/usr/bin/security", [
    "set-key-partition-list",
    "-S",
    "apple-tool:,apple:,codesign:",
    "-s",
    "-k",
    password,
    keychain,
  ]);
  // Trust is limited to code signing in this user's trust settings.
  const trusted = await exec("/usr/bin/security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
    keychain,
  ]);
  if (!trusted.stdout.includes(identity))
    throw new Error(
      `Approve this certificate once in the MacBook Terminal: security add-trusted-cert -r trustRoot -p codeSign -k '${keychain}' '${cert}'`,
    );
  const record = { identity, keychain, passwordFile, createdAt: new Date().toISOString() };
  const requirements = [];
  for (const name of ["true", "false"]) {
    const probe = NodePath.join(root, `identity-probe-${name}`);
    await NodeFSP.copyFile(`/usr/bin/${name}`, probe);
    await NodeFSP.chmod(probe, 0o700);
    await exec("/usr/bin/codesign", [
      "--force",
      ...identityArguments(record),
      "--identifier",
      "bio.logomix.t3.signing-probe",
      probe,
    ]);
    await exec("/usr/bin/codesign", ["--verify", "--strict", probe]);
    const signed = await exec("/usr/bin/codesign", ["-d", "-r-", probe]);
    requirements.push(
      (signed.stderr + signed.stdout).split("\n").find((line) => line.includes("designated =>")),
    );
  }
  if (!requirements[0] || requirements[0] !== requirements[1] || requirements[0].includes("cdhash"))
    throw new Error("The signing requirement did not remain stable across different binaries");
  record.designatedRequirement = requirements[0];
  await NodeFSP.writeFile(recordFile, JSON.stringify(record, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  return record;
}
