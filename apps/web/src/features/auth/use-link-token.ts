import { linkTokenSchema } from '@a-ai/validation';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { tokenFromHash } from './form-errors';

/**
 * Reads the one-time token from `#token=...` once, then removes it from the
 * address bar so it does not stay in browser history. Returns null when the
 * link has no token or a malformed one.
 */
export function useLinkToken(): string | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => {
    const raw = tokenFromHash(location.hash);
    return raw && linkTokenSchema.safeParse(raw).success ? raw : null;
  });

  useEffect(() => {
    if (location.hash) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate]);

  return token;
}
