#!/usr/bin/env bash
# write-checksums.sh <dir>: writes <dir>/SHA256SUMS for every file under <dir> and prints its digest.
# Every artifact carries this manifest; trusted jobs pass the digest on through job outputs.
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

cd "$(posix "$1")" || die "cannot enter checksum directory"
manifest=$(mktemp)
find . -type f ! -name SHA256SUMS | sed 's|^\./||' | LC_ALL=C sort | while IFS= read -r file; do sha256 "$file"; done > "$manifest"
mv "$manifest" SHA256SUMS
cat SHA256SUMS >&2
sha256 SHA256SUMS | cut -c1-64
