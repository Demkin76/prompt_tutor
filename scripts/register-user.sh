#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <email> [--prod|--deployment <name>]" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
email=$1
shift

deployment_args=()
case "${1:-}" in
  "")
    ;;
  --prod)
    deployment_args=(--prod)
    shift
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

read -r -s -p "Password (8+ characters): " password
echo
read -r -s -p "Confirm password: " confirmation
echo

[[ ${#password} -ge 8 ]] || {
  echo "Password must be at least 8 characters." >&2
  exit 1
}
[[ "$password" == "$confirmation" ]] || {
  echo "Passwords do not match." >&2
  exit 1
}

registration_secret="$(
  npx convex env "${deployment_args[@]}" get ADMIN_REGISTRATION_SECRET 2>/dev/null || true
)"
if [[ -z "$registration_secret" ]]; then
  registration_secret="$(openssl rand -hex 32)"
  npx convex env "${deployment_args[@]}" set ADMIN_REGISTRATION_SECRET "$registration_secret" >/dev/null
  echo "Initialized ADMIN_REGISTRATION_SECRET on the selected deployment."
fi

payload="$(
  EMAIL="$email" PASSWORD="$password" REGISTRATION_SECRET="$registration_secret" node -e '
    process.stdout.write(JSON.stringify({
      provider: "password",
      params: {
        flow: "signUp",
        email: process.env.EMAIL,
        password: process.env.PASSWORD,
        registrationSecret: process.env.REGISTRATION_SECRET,
      },
    }));
  '
)"

npx convex run auth:signIn "$payload" "${deployment_args[@]}" >/dev/null
echo "Registered $email."
