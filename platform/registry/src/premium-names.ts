import type { SailRegistryConfig } from "./config.js";

export interface PremiumNameStatus {
  canonicalName: string;
  premium: boolean;
  mojangUuid?: string;
  mojangName?: string;
}

export interface PremiumNameLookup {
  lookup(canonicalName: string): Promise<PremiumNameStatus>;
}

export class PremiumNameLookupUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PremiumNameLookupUnavailableError";
  }
}

type FetchLike = typeof fetch;

interface MojangProfileLookupOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export class MojangProfilePremiumNameLookup implements PremiumNameLookup {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: MojangProfileLookupOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.timeoutMs = options.timeoutMs ?? 2_500;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async lookup(canonicalName: string): Promise<PremiumNameStatus> {
    const url = `${this.baseUrl}/users/profiles/minecraft/${encodeURIComponent(canonicalName)}`;
    const abortController = new AbortController();
    const timeout = this.timeoutMs > 0
      ? setTimeout(() => abortController.abort(), this.timeoutMs)
      : undefined;

    try {
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Sail Registry/0.1.0",
        },
        signal: abortController.signal,
      });

      if (response.status === 204 || response.status === 404) {
        return {
          canonicalName,
          premium: false,
        };
      }

      if (response.status !== 200) {
        throw new PremiumNameLookupUnavailableError(
          `Mojang profile lookup returned HTTP ${response.status}`,
        );
      }

      const body = await response.json() as unknown;
      if (!isMojangProfile(body)) {
        throw new PremiumNameLookupUnavailableError("Mojang profile lookup returned an invalid profile document");
      }

      return {
        canonicalName,
        premium: true,
        mojangUuid: body.id,
        mojangName: body.name,
      };
    } catch (error) {
      if (error instanceof PremiumNameLookupUnavailableError) {
        throw error;
      }
      throw new PremiumNameLookupUnavailableError("Mojang profile lookup failed", {
        cause: error,
      });
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

interface CachedPremiumNameLookupOptions {
  positiveTtlMs: number;
  negativeTtlMs: number;
  now?: () => number;
}

interface CacheEntry {
  expiresAtMs: number;
  status: PremiumNameStatus;
}

export class CachedPremiumNameLookup implements PremiumNameLookup {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly now: () => number;

  constructor(
    private readonly delegate: PremiumNameLookup,
    private readonly options: CachedPremiumNameLookupOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  async lookup(canonicalName: string): Promise<PremiumNameStatus> {
    const cached = this.cache.get(canonicalName);
    const now = this.now();
    if (cached && cached.expiresAtMs > now) {
      return cached.status;
    }

    const status = await this.delegate.lookup(canonicalName);
    const ttl = status.premium ? this.options.positiveTtlMs : this.options.negativeTtlMs;
    if (ttl > 0) {
      this.cache.set(canonicalName, {
        expiresAtMs: now + ttl,
        status,
      });
    } else {
      this.cache.delete(canonicalName);
    }
    return status;
  }
}

export function createPremiumNameLookup(config: SailRegistryConfig): PremiumNameLookup {
  return new CachedPremiumNameLookup(
    new MojangProfilePremiumNameLookup({
      baseUrl: config.mojangProfileApiUrl,
      timeoutMs: config.mojangLookupTimeoutMs,
    }),
    {
      positiveTtlMs: config.premiumNamePositiveCacheSeconds * 1_000,
      negativeTtlMs: config.premiumNameNegativeCacheSeconds * 1_000,
    },
  );
}

function isMojangProfile(value: unknown): value is { id: string; name: string } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && /^[0-9a-fA-F]{32}$/u.test(candidate.id)
    && typeof candidate.name === "string"
    && /^[A-Za-z0-9_]{3,16}$/u.test(candidate.name);
}
