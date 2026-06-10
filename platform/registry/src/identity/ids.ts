const uuidWithoutDashes = /^[0-9a-f]{32}$/u;

export function accountPublicId(id: string): string {
  return prefixed("acct", id);
}

export function minecraftIdentityPublicId(id: string): string {
  return prefixed("mcid", id);
}

export function nameClaimPublicId(id: string): string {
  return prefixed("claim", id);
}

export function challengePublicId(id: string): string {
  return prefixed("ch", id);
}

export function sessionPublicId(id: string): string {
  return prefixed("sess", id);
}

export function parseChallengePublicId(id: string): string {
  return parsePrefixed("ch", id);
}

export function parseSessionPublicId(id: string): string {
  return parsePrefixed("sess", id);
}

function prefixed(prefix: string, id: string): string {
  return `${prefix}_${id.replaceAll("-", "").toLowerCase()}`;
}

function parsePrefixed(prefix: string, id: string): string {
  const raw = id.startsWith(`${prefix}_`) ? id.slice(prefix.length + 1).toLowerCase() : "";
  if (!uuidWithoutDashes.test(raw)) {
    throw new Error(`Invalid Sail ${prefix} id`);
  }
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}
