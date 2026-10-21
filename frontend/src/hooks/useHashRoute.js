import { useCallback, useEffect, useState } from "react";

/**
 * Hash routing for the platform: `#/swap`, `#/pools`, `#/labs/experiment-4`.
 *
 * Still a hash route rather than a router dependency — linkable, survives a
 * reload, costs nothing. Links from before the platform existed
 * (`#/experiment-3`) are read as `#/labs/experiment-3`, so they keep working.
 *
 * @param {Set<string>} validRoutes  top-level route names
 * @param {string} fallback          route used for an empty or unknown hash
 * @returns {{ route: string, sub: string, navigate: (route: string, sub?: string) => void }}
 */
export function useHashRoute(validRoutes, fallback) {
  const read = useCallback(() => {
    const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (/^experiment-\d+$/.test(parts[0] ?? "")) return { route: "labs", sub: parts[0] };
    if (!validRoutes.has(parts[0])) return { route: fallback, sub: "" };
    return { route: parts[0], sub: parts[1] ?? "" };
  }, [validRoutes, fallback]);

  const [location, setLocation] = useState(read);

  useEffect(() => {
    const onHashChange = () => {
      setLocation(read());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [read]);

  const navigate = useCallback((route, sub = "") => {
    window.location.hash = sub ? `#/${route}/${sub}` : `#/${route}`;
  }, []);

  return { ...location, navigate };
}
