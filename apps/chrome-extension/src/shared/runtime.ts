export function extensionAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

export function isContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /extension context invalidated/i.test(message);
}
