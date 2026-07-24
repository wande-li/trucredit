// TruCredit — Shopify-standard Toast feedback for all action results.
// Ported from Wandex. Place <ActionToast fetcher={fetcher} /> inside any
// component that uses useFetcher(). Automatically shows App Bridge Toast
// (or DOM fallback) on success/error.

import { useEffect, useRef } from "react";
import { useAppToast } from "~/hooks/useAppToast";

interface FetchData {
  success?: boolean;
  error?: string;
  message?: string;
}

interface Props {
  fetcher: { data?: unknown; state?: string; formData?: FormData };
  successMessage?: string;
  errorMessage?: string;
}

export default function ActionToast({ fetcher, successMessage, errorMessage }: Props) {
  const { showSuccess, showError } = useAppToast();
  const lastFiredRef = useRef<unknown>(null);

  const showSuccessRef = useRef(showSuccess);
  showSuccessRef.current = showSuccess;
  const showErrorRef = useRef(showError);
  showErrorRef.current = showError;

  useEffect(() => {
    const data = fetcher.data as FetchData | undefined;
    if (!data) return;

    if (data === lastFiredRef.current) return;
    lastFiredRef.current = data;

    if (data.success) {
      showSuccessRef.current(
        successMessage || data.message || "Action completed successfully",
      );
    }
    if (data.error) {
      showErrorRef.current(errorMessage || data.error);
    }
    if (data.success === false && !data.error) {
      showErrorRef.current(errorMessage || "Operation failed");
    }
  }, [fetcher.data, successMessage, errorMessage]);

  return null;
}
