import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type NoticeKind = "error" | "success" | "info";
export type NoticePlacement = "floating" | "inline";

const DEFAULT_DISMISS_MS: Record<NoticeKind, number> = {
  error: 8_000,
  success: 5_000,
  info: 6_000,
};

type NoticeContentProps = {
  kind: NoticeKind;
  title: string;
  message: string;
  closeLabel: string;
  onDismiss: () => void;
  placement?: NoticePlacement;
};

type NoticeBannerProps = NoticeContentProps & {
  autoDismissMs?: number;
};

export function scheduleNoticeDismiss(onDismiss: () => void, delayMs: number) {
  const timer = globalThis.setTimeout(onDismiss, delayMs);
  return () => globalThis.clearTimeout(timer);
}

function NoticeIcon({ kind }: { kind: NoticeKind }) {
  if (kind === "error") return <CircleAlert data-lucide="circle-alert" size={19} aria-hidden="true" />;
  if (kind === "success") return <CircleCheck data-lucide="circle-check" size={19} aria-hidden="true" />;
  return <Info data-lucide="info" size={19} aria-hidden="true" />;
}

export function NoticeBannerContent({
  kind,
  title,
  message,
  closeLabel,
  onDismiss,
  placement = "floating",
}: NoticeContentProps) {
  return (
    <div
      className={`notice-banner notice-banner--${kind} notice-banner--${placement}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
    >
      <span className="notice-banner__icon"><NoticeIcon kind={kind} /></span>
      <span className="notice-banner__copy">
        <strong>{title}</strong>
        <span>{message}</span>
      </span>
      <button
        type="button"
        className="notice-banner__close"
        aria-label={closeLabel}
        title={closeLabel}
        onClick={onDismiss}
      >
        <X size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function NoticeBanner({ autoDismissMs, onDismiss, ...contentProps }: NoticeBannerProps) {
  const [paused, setPaused] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (paused) return;
    return scheduleNoticeDismiss(
      () => dismissRef.current(),
      autoDismissMs ?? DEFAULT_DISMISS_MS[contentProps.kind],
    );
  }, [autoDismissMs, contentProps.kind, contentProps.message, paused]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      <NoticeBannerContent {...contentProps} onDismiss={onDismiss} />
    </div>
  );
}
