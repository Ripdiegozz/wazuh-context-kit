import { useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
}

/** Small fetch-on-mount hook. No caching, no retries -- this is a local single-user inspector. */
export function useAsync<T>(fetcher: () => Promise<T>, deps: readonly unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, error: undefined, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ data, error: undefined, loading: false });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ data: undefined, error: error as Error, loading: false });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
