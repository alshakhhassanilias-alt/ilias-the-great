import type { ReactNode } from "react";

const STATUS_CLASS: Record<string, string> = {
  HEALTHY: "b-green",
  DEGRADED: "b-amber",
  HALTED: "b-red",
  DISCONNECTED: "b-grey",
  RECOVERING: "b-purple",
  STOPPED: "b-grey",
};

export function StatusBadge({ status, testId }: { status: string | null | undefined; testId?: string }) {
  const s = (status ?? "").toUpperCase();
  return (
    <span className={`badge ${STATUS_CLASS[s] ?? "b-grey"}`} data-testid={testId} title="System status">
      {s || "UNKNOWN"}
    </span>
  );
}

const VALIDATION_CLASS: Record<string, string> = {
  promoted: "b-green",
  under_review: "b-amber",
  research_only: "b-grey",
  rejected: "b-red",
  unvalidated: "b-grey",
};

export function ValidationBadge({ status }: { status: string | null | undefined }) {
  const s = (status ?? "unvalidated").toLowerCase();
  return <span className={`badge ${VALIDATION_CLASS[s] ?? "b-grey"}`}>{s.replace(/_/g, " ").toUpperCase()}</span>;
}

const SEVERITY_CLASS: Record<string, string> = {
  critical: "b-red",
  error: "b-red",
  emergency: "b-red",
  warning: "b-amber",
  warn: "b-amber",
  info: "b-blue",
};

export function SeverityBadge({ severity }: { severity: string | null | undefined }) {
  const s = (severity ?? "").toLowerCase();
  return <span className={`badge badge-sm ${SEVERITY_CLASS[s] ?? "b-grey"}`}>{(severity ?? "—").toUpperCase()}</span>;
}

export function Tag({ children, tone = "grey" }: { children: ReactNode; tone?: "grey" | "amber" | "red" | "green" | "blue" | "purple" }) {
  return <span className={`badge badge-sm b-${tone}`}>{children}</span>;
}
