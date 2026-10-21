import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { HttpError } from './errors.js';
import { safeFetch } from './providers.js';
export type AuthConfig = {
    mode: 'development' | 'access';
    host: string;
    teamDomain?: string;
    audience?: string;
    jwks?: () => Promise<JsonWebKey[]>;
};
export function authBoundary(config: AuthConfig) {
    if (config.mode === 'development') {
        if (!['127.0.0.1', '::1'].includes(config.host))
            throw new Error('Development mode must bind to loopback.');
        return async (_token: string | undefined, ip: string | undefined) => {
            if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip ?? ''))
                throw new HttpError(403, 'Development mode only accepts loopback connections.');
        };
    }
    if (!config.teamDomain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.teamDomain) || !config.audience)
        throw new Error('Access mode requires ACCESS_TEAM_DOMAIN and ACCESS_AUDIENCE.');
    const issuer = `https://${config.teamDomain}`;
    let keys: JsonWebKey[] = [];
    let expires = 0;
    const load = config.jwks ?? (async () => {
        const response = await safeFetch(`${issuer}/cdn-cgi/access/certs`, 256000, [config.teamDomain!]);
        const json = JSON.parse(response.toString());
        if (!Array.isArray(json.keys))
            throw new Error('Invalid key response');
        return json.keys;
    });
    let pending: Promise<void> | null = null;
    async function refresh() {
        if (!pending)
            pending = load().then(value => { keys = value; expires = Date.now() + 300000; }).finally(() => { pending = null; });
        await pending;
    }
    return async (token: string | undefined, _ip: string | undefined) => {
        if (!token || token.length > 16000)
            throw new HttpError(401, 'Cloudflare Access authentication required.');
        try {
            const parts = token.split('.');
            if (parts.length !== 3)
                throw new Error();
            const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
            const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
            if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit)
                throw new Error();
            if (Date.now() >= expires)
                await refresh();
            const key = keys.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256'));
            if (!key || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url')))
                throw new Error();
            const now = Date.now() / 1000;
            if (claims.iss !== issuer || !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(config.audience) ||
                !Number.isFinite(claims.exp) || claims.exp < now - 5 || !Number.isFinite(claims.iat) || claims.iat > now + 5 ||
                typeof claims.sub !== 'string' || !claims.sub || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 5)))
                throw new Error();
        }
        catch {
            throw new HttpError(401, 'Invalid or expired Cloudflare Access session.');
        }
    };
}
