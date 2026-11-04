import {
  randomBytes,
  scrypt as scryptCb,
  scryptSync,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

// Parâmetros scrypt (padrão recomendado). O custo N=2^14 equilibra segurança e
// latência de login em uma VPS de porte médio. Formato persistido:
//   scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
const N = 16384; // 2^14
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

// Hash descartável, em formato válido, usado para equalizar o tempo de resposta
// do login quando o e-mail não existe ou não tem senha local — assim o tempo de
// verificação não revela se a conta existe (proteção contra enumeração).
const DUMMY_SALT = randomBytes(SALT_BYTES);
export const DUMMY_PASSWORD_HASH = `scrypt$${N}$${R}$${P}$${DUMMY_SALT.toString(
  "hex"
)}$${scryptSync("", DUMMY_SALT, KEYLEN, { N, r: R, p: P }).toString("hex")}`;

/**
 * Gera o hash de uma senha em texto puro. O resultado é auto-descritivo
 * (inclui parâmetros e salt), apto a ser gravado em users.passwordHash.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scrypt(password, salt, KEYLEN, {
    N,
    r: R,
    p: P,
  })) as Buffer;
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Verifica uma senha contra um hash gravado. Comparação em tempo constante.
 * Retorna false para hashes ausentes/malformados, sem lançar.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined
): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");

  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = (await scrypt(password, salt, expected.length, {
      N: n,
      r,
      p,
    })) as Buffer;
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
