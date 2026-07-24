// TruCredit — Shared App Bridge Toast Hook
// Ported from Wandex. Uses Shopify-standard native toast notifications
// with DOM fallback when running outside App Bridge (non-embedded).

import { useAppBridge } from "@shopify/app-bridge-react";

interface ToastOptions {
  message: string;
  duration?: number; // ms, default 3000
  isError?: boolean;
  onDismiss?: () => void;
}

type ToastFn = (
  message: string,
  options?: Omit<ToastOptions, "message">,
) => void;

let toastFn: ToastFn | null = null;

// ── DOM toast fallback (visible when App Bridge unavailable) ──

let _container: HTMLDivElement | null = null;

function getContainer(): HTMLDivElement {
  if (!_container) {
    _container = document.createElement("div");
    _container.id = "app-toast-container";
    _container.style.cssText =
      "position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;align-items:center;";
    document.body.appendChild(_container);
  }
  return _container;
}

function createDomToast(
  message: string,
  isError: boolean,
  duration: number,
): void {
  const el = document.createElement("div");
  const bg = isError
    ? "var(--p-color-bg-fill-critical, #d82c0d)"
    : "var(--p-color-bg-fill-success, #007f5f)";
  const fg = "var(--p-color-text-on-color, #fff)";
  el.style.cssText = `
    background:${bg};color:${fg};padding:12px 20px;border-radius:8px;
    font-size:14px;font-family:Inter,system-ui,sans-serif;font-weight:500;
    box-shadow:0 4px 16px rgba(0,0,0,0.15);pointer-events:auto;
    opacity:0;transform:translateY(-12px);
    transition:opacity 0.25s ease,transform 0.25s ease;
    max-width:400px;line-height:1.4;
  `;
  el.textContent = message;
  getContainer().appendChild(el);

  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-8px)";
    el.addEventListener("transitionend", () => el.remove());
    setTimeout(() => el.parentNode && el.remove(), 300);
  }, duration);
}

// ── Hook ──

export function useAppToast(): {
  showSuccess: (msg: string, duration?: number) => void;
  showError: (msg: string, duration?: number) => void;
  toast: (opts: ToastOptions) => void;
} {
  try {
    const app = useAppBridge();
    toastFn = (message: string, opts: Omit<ToastOptions, "message"> = {}) => {
      if (opts.isError) {
        app.toast
          ? app.toast.show(message, {
              isError: true,
              duration: opts.duration ?? 4000,
            })
          : createDomToast(message, true, opts.duration ?? 4000);
      } else {
        app.toast
          ? app.toast.show(message, { duration: opts.duration ?? 3000 })
          : createDomToast(message, false, opts.duration ?? 3000);
      }
    };
  } catch {
    toastFn = (message: string, opts: Omit<ToastOptions, "message"> = {}) => {
      createDomToast(message, !!opts.isError, opts.duration ?? 3000);
    };
  }

  return {
    showSuccess: (msg: string, duration?: number) =>
      toastFn?.(msg, { duration }),
    showError: (msg: string, duration?: number) =>
      toastFn?.(msg, { isError: true, duration }),
    toast: (opts: ToastOptions) => toastFn?.(opts.message, opts),
  };
}

export function showToast(message: string, isError = false) {
  if (toastFn) {
    toastFn(message, { isError });
  } else {
    createDomToast(message, isError, 3000);
  }
}

export function showErrorToast(message: string) {
  showToast(message, true);
}
