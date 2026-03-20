const HOME_PATTERNS = [
  /^\/home\/[^/]+/,
  /^\/Users\/[^/]+/,
  /^\/root/,
];

export function shortenPath(path: string, homeDir?: string): string {
  if (homeDir) {
    return path.replace(homeDir, '~');
  }
  
  for (const pattern of HOME_PATTERNS) {
    const match = path.match(pattern);
    if (match) {
      return path.replace(match[0], '~');
    }
  }
  
  return path;
}

export function getFolderName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}
