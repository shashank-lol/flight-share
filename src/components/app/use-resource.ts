'use client';

import {useCallback, useEffect, useState} from 'react';
import {api} from './api';

type Result<T> = {path: string; data?: T; error?: unknown};

export function useResource<T>(path: string | null) {
  const [result, setResult] = useState<Result<T>>();
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((previous) => previous + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api<T>(path, {signal: controller.signal}).then(
      (data) => { if (!controller.signal.aborted) setResult({path, data}); },
      (error: unknown) => { if (!controller.signal.aborted) setResult({path, error}); },
    );
    return () => controller.abort();
  }, [path, revision]);
  return {data: result?.path === path ? result?.data : undefined, error: result?.path === path ? result?.error : undefined, reload};
}