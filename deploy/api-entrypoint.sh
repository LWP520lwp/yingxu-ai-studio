#!/bin/sh
set -eu
# Fail before serving a public site with incomplete authentication or persistence configuration.
: "${DB_PASSWORD:?Set DB_PASSWORD with scripts/init-deployment.mjs}"
: "${REDIS_PASSWORD:?Set REDIS_PASSWORD with scripts/init-deployment.mjs}"
: "${POOL_CREDENTIAL_MASTER_KEY:?Set a stable, independently generated 32-byte encryption key}"
: "${FRONTEND_URL:?Set the deployment HTTPS origin}"
if [ "${APP_PROFILE:-}" != prod ]; then
    printf '%s\n' 'Production profile is required.' >&2
    exit 1
fi
case "$FRONTEND_URL" in https://*) ;; *) printf '%s\n' 'A public HTTPS origin is required.' >&2; exit 1;; esac
auth_ready=false
if [ -n "${GITHUB_CLIENT_ID:-}" ] || [ -n "${GITHUB_CLIENT_SECRET:-}" ]; then
    : "${GITHUB_CLIENT_ID:?Set the deployment OAuth App Client ID}"
    : "${GITHUB_CLIENT_SECRET:?Set the deployment OAuth App Client Secret}"
    if [ "${GITHUB_REDIRECT_URI:-}" != "${FRONTEND_URL%/}/login/oauth2/code/github" ]; then
        printf '%s\n' 'The GitHub callback must match the public HTTPS origin.' >&2
        exit 1
    fi
    auth_ready=true
fi
if [ -n "${REVIEWER_USERNAME:-}" ] || [ -n "${REVIEWER_PASSWORD_HASH:-}" ]; then
    if ! printf '%s' "${REVIEWER_USERNAME:-}" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$' ||
       ! printf '%s' "${REVIEWER_PASSWORD_HASH:-}" | grep -Eq '^pbkdf2-sha256\$(210000|[3-9][0-9]{5}|1000000)\$[a-f0-9]{32}\$[a-f0-9]{64}$'; then
        printf '%s\n' 'Initialize a valid private reviewer login with scripts/init-reviewer.mjs.' >&2
        exit 1
    fi
    auth_ready=true
fi
if [ "$auth_ready" != true ]; then
    printf '%s\n' 'Configure GitHub OAuth or a private reviewer login before starting production.' >&2
    exit 1
fi
mkdir -p /var/lib/workbench/assets /var/lib/workbench/upload-temp
exec java -XX:MaxRAMPercentage=65.0 -XX:+ExitOnOutOfMemoryError -Djava.awt.headless=true -jar /app/app.jar "$@"

