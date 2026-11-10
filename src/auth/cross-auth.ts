import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  loadMergedEnv,
  redactSecret,
  redactTextSecrets,
  runCommandCapture,
} from "../discovery.ts";

export interface ProviderAuthStatus {
  provider: string;
  label: string;
  ready: boolean;
  mechanism: string;
  envStatus: string;
  credentialStore: string;
  details: string;
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export interface AuthorizationUrlOptions {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope?: string | string[];
  state?: string;
  codeChallenge: string;
  codeChallengeMethod?: "S256";
  resource?: string;
  extraParams?: Record<string, string>;
}

export interface DeviceAuthorizationRequest {
  deviceAuthorizationEndpoint: string;
  clientId: string;
  scope?: string | string[];
  audience?: string;
}

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenPollOptions {
  tokenEndpoint: string;
  clientId: string;
  deviceCode: string;
  intervalSeconds?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
}

export interface VaultEntryMetadata {
  provider: string;
  accountHint?: string;
  scopes: string[];
  issuedAt: string;
  expiresAt?: string;
  tokenType: string;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  encryptedCiphertextB64?: string;
  ivB64?: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string): Uint8Array {
  const padded =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((input.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function computePkceChallengeS256(codeVerifier: string): string {
  const hashB64 = Bun.CryptoHasher.hash("sha256", codeVerifier, "base64");
  return hashB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function generatePkcePair(byteLength = 32): PkcePair {
  const clamped = Math.max(32, Math.min(96, byteLength));
  const randomBytes = new Uint8Array(clamped);
  crypto.getRandomValues(randomBytes);
  const codeVerifier = toBase64Url(randomBytes);
  const codeChallenge = computePkceChallengeS256(codeVerifier);
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256",
  };
}

export function generateOAuthState(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function buildAuthorizationUrl(opts: AuthorizationUrlOptions): {
  url: string;
  state: string;
} {
  const url = new URL(opts.authorizationEndpoint);
  const state = opts.state ?? generateOAuthState();
  const scopeStr = Array.isArray(opts.scope)
    ? opts.scope.join(" ")
    : (opts.scope ?? "openid profile email");

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("code_challenge", opts.codeChallenge);
  url.searchParams.set(
    "code_challenge_method",
    opts.codeChallengeMethod ?? "S256",
  );
  url.searchParams.set("state", state);
  if (scopeStr.trim().length > 0) {
    url.searchParams.set("scope", scopeStr);
  }
  if (opts.resource) {
    url.searchParams.set("resource", opts.resource);
  }
  if (opts.extraParams) {
    for (const [k, v] of Object.entries(opts.extraParams)) {
      url.searchParams.set(k, v);
    }
  }
  return { url: url.toString(), state };
}

export async function initiateDeviceCodeFlow(
  req: DeviceAuthorizationRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<DeviceAuthorizationResponse> {
  const body = new URLSearchParams();
  body.set("client_id", req.clientId);
  if (req.scope) {
    body.set(
      "scope",
      Array.isArray(req.scope) ? req.scope.join(" ") : req.scope,
    );
  }
  if (req.audience) {
    body.set("audience", req.audience);
  }

  const resp = await fetchImpl(req.deviceAuthorizationEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    throw new Error(`Device authorization failed with HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as Partial<DeviceAuthorizationResponse>;
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error(
      "Invalid RFC 8628 device authorization response missing required fields",
    );
  }

  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    verification_uri_complete: data.verification_uri_complete,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : 900,
    interval: typeof data.interval === "number" ? data.interval : 5,
  };
}

export async function pollDeviceTokenOnce(
  opts: DeviceTokenPollOptions,
): Promise<
  | {
      status: "authorized";
      tokenType: string;
      expiresIn?: number;
      scope?: string;
    }
  | { status: "pending"; intervalSeconds: number }
  | { status: "denied"; error: string }
> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: opts.deviceCode,
    client_id: opts.clientId,
  });

  const resp = await fetchFn(opts.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });

  const payload = (await resp.json()) as Record<string, unknown>;
  if (resp.ok && typeof payload.access_token === "string") {
    return {
      status: "authorized",
      tokenType:
        typeof payload.token_type === "string" ? payload.token_type : "Bearer",
      expiresIn:
        typeof payload.expires_in === "number" ? payload.expires_in : undefined,
      scope: typeof payload.scope === "string" ? payload.scope : undefined,
    };
  }

  const errCode =
    typeof payload.error === "string" ? payload.error : `http_${resp.status}`;
  const baseInterval = opts.intervalSeconds ?? 5;
  if (errCode === "authorization_pending") {
    return { status: "pending", intervalSeconds: baseInterval };
  }
  if (errCode === "slow_down") {
    return { status: "pending", intervalSeconds: baseInterval + 5 };
  }
  return { status: "denied", error: errCode };
}

async function deriveVaultAesKey(passphrase: string): Promise<CryptoKey> {
  const rawHash = Bun.CryptoHasher.hash("sha256", passphrase, "base64");
  const binary = atob(rawHash);
  const keyBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    keyBytes[i] = binary.charCodeAt(i);
  }
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function sealTokenPayload(
  secretPayloadJson: string,
  machineKeyMaterial: string,
): Promise<{ ciphertextB64: string; ivB64: string }> {
  const key = await deriveVaultAesKey(machineKeyMaterial);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encoded = new TextEncoder().encode(secretPayloadJson);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );
  return {
    ciphertextB64: toBase64Url(new Uint8Array(encrypted)),
    ivB64: toBase64Url(iv),
  };
}

export async function unsealTokenPayload(
  ciphertextB64: string,
  ivB64: string,
  machineKeyMaterial: string,
): Promise<string> {
  const key = await deriveVaultAesKey(machineKeyMaterial);
  const iv = fromBase64Url(ivB64);
  const cipher = fromBase64Url(ciphertextB64);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    cipher as BufferSource,
  );
  return new TextDecoder().decode(plainBuf);
}

export function lockVaultFileAcl(vaultPath: string): void {
  if (!existsSync(vaultPath)) return;
  if (process.platform === "win32") {
    const username = process.env.USERNAME ?? "";
    if (username) {
      runCommandCapture([
        "icacls",
        vaultPath,
        "/inheritance:r",
        "/grant:r",
        `${username}:(R,W)`,
      ]);
    }
  } else {
    try {
      chmodSync(vaultPath, 0o600);
    } catch {
      // Ignore chmod failure
    }
  }
}

export function writeVaultMetadata(
  vaultPath: string,
  entries: VaultEntryMetadata[],
): void {
  const dir = dirname(vaultPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const safeDoc = {
    schema: "sovereign.ai-triad.vault.v1",
    updatedAt: new Date().toISOString(),
    entries,
  };
  writeFileSync(vaultPath, `${JSON.stringify(safeDoc, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  lockVaultFileAcl(vaultPath);
}

function inspectJsonKeysOnly(filePath: string): {
  exists: boolean;
  sizeBytes: number;
  topKeys: string[];
} {
  if (!existsSync(filePath)) {
    return { exists: false, sizeBytes: 0, topKeys: [] };
  }
  try {
    const st = statSync(filePath);
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      exists: true,
      sizeBytes: st.size,
      topKeys: Object.keys(parsed),
    };
  } catch {
    return { exists: true, sizeBytes: 0, topKeys: ["<parse-protected>"] };
  }
}

export async function inspectCrossAuthStatus(options?: {
  home?: string;
  envFilePath?: string;
  rustAuthHealthUrl?: string;
  skipCliProbes?: boolean;
}): Promise<ProviderAuthStatus[]> {
  const home = options?.home ?? homedir();
  const env = loadMergedEnv(options?.envFilePath);
  const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
  const results: ProviderAuthStatus[] = [];

  // 1. Claude Code
  const claudeCredPath = join(home, ".claude", ".credentials.json");
  const claudeCred = inspectJsonKeysOnly(claudeCredPath);
  const anthropicKey = env.ANTHROPIC_API_KEY;
  results.push({
    provider: "claude",
    label: "Anthropic Claude Code",
    ready: claudeCred.exists || Boolean(anthropicKey),
    mechanism: claudeCred.exists
      ? "OAuth2 Keychain/Credentials + Optional API Key"
      : anthropicKey
        ? "ANTHROPIC_API_KEY"
        : "unauthenticated",
    envStatus: `ANTHROPIC_API_KEY=${redactSecret(anthropicKey)}`,
    credentialStore: claudeCred.exists
      ? `${claudeCredPath} (present, keys=${claudeCred.topKeys.length}, ${claudeCred.sizeBytes}B)`
      : "absent",
    details: claudeCred.exists
      ? `OAuth sections present: [${claudeCred.topKeys.join(", ")}]`
      : "Run `claude auth login` or set ANTHROPIC_API_KEY",
  });

  // 2. OpenAI Codex
  const codexAuthPath = join(home, ".codex", "auth.json");
  const codexCred = inspectJsonKeysOnly(codexAuthPath);
  const openAiKey = env.OPENAI_API_KEY;
  results.push({
    provider: "codex",
    label: "OpenAI Codex CLI",
    ready: codexCred.exists || Boolean(openAiKey),
    mechanism: codexCred.exists
      ? "OAuth2 PKCE / RFC 8628 Device Auth"
      : openAiKey
        ? "OPENAI_API_KEY"
        : "unauthenticated",
    envStatus: `OPENAI_API_KEY=${redactSecret(openAiKey)}`,
    credentialStore: codexCred.exists
      ? `${codexAuthPath} (present, keys=${codexCred.topKeys.length}, ${codexCred.sizeBytes}B)`
      : "absent",
    details: codexCred.exists
      ? `Codex auth keys: [${codexCred.topKeys.join(", ")}]`
      : openAiKey
        ? "Ready via OPENAI_API_KEY (or run `codex login --device-auth`)"
        : "Run `codex login --device-auth` or set OPENAI_API_KEY",
  });

  // 3. Google Antigravity + Gemini + ADC
  const adcPath =
    process.platform === "win32"
      ? join(appData, "gcloud", "application_default_credentials.json")
      : join(home, ".config", "gcloud", "application_default_credentials.json");
  const agyStatePath = join(
    home,
    ".gemini",
    "antigravity-cli",
    "jetski_state.pbtxt",
  );
  const geminiOauthPath = join(home, ".gemini", "oauth_creds.json");
  const adcInfo = inspectJsonKeysOnly(adcPath);
  const geminiOauthInfo = inspectJsonKeysOnly(geminiOauthPath);
  const agyStateExists = existsSync(agyStatePath);
  const geminiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  results.push({
    provider: "antigravity-gemini",
    label: "Google Antigravity & Gemini",
    ready:
      agyStateExists ||
      adcInfo.exists ||
      geminiOauthInfo.exists ||
      Boolean(geminiKey),
    mechanism: agyStateExists
      ? "Antigravity Session + Gemini API/ADC"
      : adcInfo.exists
        ? "Google ADC OAuth2"
        : geminiKey
          ? "GEMINI_API_KEY"
          : "unauthenticated",
    envStatus: `GEMINI_API_KEY=${redactSecret(geminiKey)}`,
    credentialStore: [
      agyStateExists ? "agy:present" : "agy:absent",
      adcInfo.exists ? "adc:present" : "adc:absent",
      geminiOauthInfo.exists ? "gemini-oauth:present" : "gemini-oauth:absent",
    ].join(", "),
    details: `Project=${env.GOOGLE_CLOUD_PROJECT ?? "auto"}`,
  });

  // 4. Sovereign Rust Auth Broker
  const rustUrl =
    options?.rustAuthHealthUrl ?? "http://127.0.0.1:4320/auth/health";
  let rustReady = false;
  let rustDetail = "offline (start sovereign rust gateway on :4320)";
  if (!options?.skipCliProbes) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const resp = await fetch(rustUrl, { signal: controller.signal });
      clearTimeout(timer);
      rustReady = resp.ok;
      rustDetail = `HTTP ${resp.status} at ${rustUrl}`;
    } catch {
      rustReady = false;
    }
  }
  results.push({
    provider: "sovereign-rust-auth",
    label: "Sovereign Rust OAuth2/PKCE Broker",
    ready: rustReady,
    mechanism: "Local OAuth2.1 + OIDC PKCE S256",
    envStatus: "LOCAL_LOOPBACK",
    credentialStore: rustUrl,
    details: rustDetail,
  });

  // 5. GitHub / Copilot, Cloudflare, GCP, Vercel
  const ghToken = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  let ghCliAuthed = false;
  let ghSummary = "env-only";
  if (!options?.skipCliProbes) {
    const ghRes = runCommandCapture(["gh", "auth", "status"], {
      timeoutMs: 4000,
    });
    ghCliAuthed = ghRes.exitCode === 0;
    const rawLine =
      (ghRes.stdout || ghRes.stderr)
        .split(/\r?\n/)
        .find((l) => l.includes("Logged in to")) ?? "";
    ghSummary = rawLine
      ? redactTextSecrets(rawLine.trim())
      : `exit=${ghRes.exitCode}`;
  }
  results.push({
    provider: "github",
    label: "GitHub CLI & Copilot",
    ready: ghCliAuthed || Boolean(ghToken),
    mechanism: ghCliAuthed ? "gh keyring OAuth" : "GITHUB_TOKEN",
    envStatus: `GITHUB_TOKEN=${redactSecret(ghToken)}`,
    credentialStore: ghCliAuthed ? "gh-cli:authenticated" : "gh-cli:unchecked",
    details: ghSummary,
  });

  const cfToken = env.CLOUDFLARE_API_TOKEN ?? env.CF_API_TOKEN;
  const vercelToken = env.VERCEL_TOKEN;
  const gcpSa = env.GOOGLE_APPLICATION_CREDENTIALS;
  results.push({
    provider: "cloud-infra",
    label: "Cloudflare / GCP / Vercel",
    ready:
      Boolean(cfToken) ||
      Boolean(vercelToken) ||
      adcInfo.exists ||
      Boolean(gcpSa),
    mechanism: "Cloud Provider Tokens & ADC",
    envStatus: [
      `CF=${redactSecret(cfToken)}`,
      `VERCEL=${redactSecret(vercelToken)}`,
      `GCP_ADC=${adcInfo.exists || Boolean(gcpSa) ? "PRESENT" : "UNSET"}`,
    ].join(" | "),
    credentialStore: adcInfo.exists ? adcPath : (gcpSa ?? "env-vars"),
    details: `CF_ACCOUNT_ID=${env.CLOUDFLARE_ACCOUNT_ID ? "SET" : "UNSET"}`,
  });

  return results;
}
