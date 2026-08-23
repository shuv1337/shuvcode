export function selectBackgroundStateHome(
  discovered: ReadonlyArray<{ readonly stateHome?: string; readonly url?: string }>,
  canonicalStateHome?: string,
  fallbackStateHome?: string,
) {
  const found =
    discovered.find((candidate) => candidate.stateHome === canonicalStateHome && candidate.url !== undefined) ??
    discovered.find((candidate) => candidate.url !== undefined)
  return {
    found,
    stateHome: found ? found.stateHome : (canonicalStateHome ?? fallbackStateHome),
  }
}
