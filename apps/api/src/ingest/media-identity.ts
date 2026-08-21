export type SourceMediaKind = 'notion-hosted' | 'external';

export class DeferredNotionIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = DeferredNotionIngestError.name;
  }
}

export interface SourceMediaRef {
  kind: SourceMediaKind;
  url: string;
  fingerprintKey: string;
  blockId?: string;
  lastEditedTime?: string;
  contentDigest?: string;
}

export const sourceMediaIdentity = (media: SourceMediaRef[]): string =>
  JSON.stringify(media.map(({ kind, fingerprintKey }) => [kind, fingerprintKey]));

export const sameMediaUrls = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((url, index) => url === right[index]);

export const mediaUrls = (media: SourceMediaRef[]): string[] =>
  media.map(({ url }) => url);

export const notionHostedFingerprint = (contentDigest: string): string =>
  `notion-hosted:sha256:${contentDigest}`;

export const externalMediaFingerprint = (url: string): string =>
  `external:${url}`;

export const notionHostedStableUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname;
    const notionHosted =
      hostname === 'secure.notion-static.com' ||
      hostname === 'file.notion.so' ||
      hostname.startsWith('prod-files-secure.s3.') ||
      (hostname.endsWith('.amazonaws.com') &&
        pathname.startsWith('/secure.notion-static.com/'));
    return notionHosted ? `${url.origin}${pathname}` : null;
  } catch {
    return null;
  }
};

export const legacyNotionMediaEquivalent = (
  storedUrls: string[],
  incoming: SourceMediaRef[],
): boolean => {
  if (storedUrls.length !== incoming.length) return false;
  return incoming.every((media, index) => {
    const storedUrl = storedUrls[index];
    if (media.kind === 'external') return storedUrl === media.url;
    const storedStable = notionHostedStableUrl(storedUrl);
    const incomingStable = notionHostedStableUrl(media.url);
    return Boolean(storedStable && incomingStable && storedStable === incomingStable);
  });
};

export const bindMediaRefsToStoredUrls = (
  incoming: SourceMediaRef[],
  storedUrls: string[],
): SourceMediaRef[] =>
  incoming.map((media, index) => ({ ...media, url: storedUrls[index] ?? media.url }));

export const mediaRefsFromRawPayload = (value: unknown): SourceMediaRef[] | null => {
  if (!value || typeof value !== 'object') return null;
  const refs = (value as { mediaRefs?: unknown }).mediaRefs;
  if (!Array.isArray(refs)) return null;
  const parsed: SourceMediaRef[] = [];
  for (const ref of refs) {
    if (!ref || typeof ref !== 'object') return null;
    const record = ref as Record<string, unknown>;
    if (
      (record.kind !== 'notion-hosted' && record.kind !== 'external') ||
      typeof record.url !== 'string' ||
      typeof record.fingerprintKey !== 'string'
    ) {
      return null;
    }
    parsed.push({
      kind: record.kind,
      url: record.url,
      fingerprintKey: record.fingerprintKey,
      ...(typeof record.blockId === 'string' ? { blockId: record.blockId } : {}),
      ...(typeof record.lastEditedTime === 'string'
        ? { lastEditedTime: record.lastEditedTime }
        : {}),
      ...(typeof record.contentDigest === 'string'
        ? { contentDigest: record.contentDigest }
        : {}),
    });
  }
  return parsed;
};
