#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 (--dev|--prod|--deployment <name>)" >&2
  echo "Use npm run auth:rotate:dev or npm run auth:rotate:prod." >&2
  exit 2
}

deployment_args=()
case "${1:-}" in
  --dev)
    shift
    ;;
  --prod)
    deployment_args=(--prod)
    shift
    read -r -p "Rotate PRODUCTION auth keys and invalidate active JWTs? [y/N] " answer
    [[ "$answer" == "y" || "$answer" == "Y" ]] || exit 1
    ;;
  --deployment)
    [[ $# -eq 2 ]] || usage
    deployment_args=(--deployment "$2")
    shift 2
    ;;
  *)
    usage
    ;;
esac
[[ $# -eq 0 ]] || usage

keys_file="$(mktemp)"
trap 'rm -f "$keys_file"' EXIT
chmod 600 "$keys_file"

node -e '
  import("jose").then(async ({ generateKeyPair, exportPKCS8, exportJWK }) => {
    const key = await generateKeyPair("RS256", { extractable: true });
    const privateKey = await exportPKCS8(key.privateKey);
    const publicKey = await exportJWK(key.publicKey);
    process.stdout.write(JSON.stringify({
      JWT_PRIVATE_KEY: privateKey.trimEnd().replace(/\n/g, " "),
      JWKS: JSON.stringify({ keys: [{ use: "sig", ...publicKey }] }),
    }));
  });
' >"$keys_file"

jwt="$(node -e 'const fs=require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).JWT_PRIVATE_KEY)' "$keys_file")"
jwks="$(node -e 'const fs=require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).JWKS)' "$keys_file")"

# Convex env updates are not atomic. Keep these adjacent to minimize the window
# where the signing key and published verification key disagree.
npx convex env "${deployment_args[@]}" set "JWT_PRIVATE_KEY=$jwt" >/dev/null
npx convex env "${deployment_args[@]}" set "JWKS=$jwks" >/dev/null

echo "Rotated auth keys. Existing access tokens are invalid; refresh or sign in again."
