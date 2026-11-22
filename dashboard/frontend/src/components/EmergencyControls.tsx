import { useEffect, useRef, useState } from "react";
import { ApiError, postControl } from "../api";
import type { ControlAction, ControlResponse } from "../types";
import { fmtMoney, isNum } from "../format";

interface ActionDef {
  action: ControlAction;
  label: string;
  phrase: string;
  testId: string;
  title: string;
  effect: string[];
  tone: "danger" | "warn" | "resume";
}

const ACTIONS: Record<ControlAction, ActionDef> = {
  flatten: {
    action: "flatten",
    label: "EMERGENCY FLATTEN",
    phrase: "FLATTEN",
    testId: "btn-flatten",
    title: "Emergency flatten all positions",
    tone: "danger",
    effect: [
      "Cancels all open orders and closes EVERY open position at market.",
      "Halts trading immediately; the halt is persisted even if the engine is offline.",
      "Trading stays halted until a human explicitly resumes it.",
    ],
  },
  "kill-switch": {
    action: "kill-switch",
    label: "KILL SWITCH",
    phrase: "KILL",
    testId: "btn-kill",
    title: "Engage kill switch",
    tone: "danger",
    effect: [
      "Engages the kill switch: no new orders will be placed by any strategy.",
      "Persists a halt immediately and queues the command for the engine.",
      "Trading stays halted until a human explicitly resumes it.",
    ],
  },
  "cancel-orders": {
    action: "cancel-orders",
    label: "CANCEL OPEN ORDERS",
    phrase: "CANCEL",
    testId: "btn-cancel",
    title: "Cancel all open orders",
    tone: "warn",
    effect: [
      "Cancels every resting open order on the exchange.",
      "Existing positions remain open (protective stops may be re-placed by the engine).",
      "Does NOT halt trading by itself.",
    ],
  },
  resume: {
    action: "resume",
    label: "RESUME TRADING",
    phrase: "RESUME",
    testId: "btn-resume",
    title: "Resume trading after a halt",
    tone: "resume",
    effect: [
      "Clears the current halt / kill switch so strategies may trade again.",
      "Hard risk limits are NOT relaxed; a new breach will halt trading again.",
      "Only resume after the halt cause has been investigated.",
    ],
  },
};

function ResultBanner({ res, onClose }: { res: { label: string; resp?: ControlResponse; error?: string }; onClose: () => void }) {
  const r = (res.resp?.result ?? {}) as Record<string, unknown>;
  const status = res.error ? "error" : res.resp?.status ?? "unknown";
  const tone = status === "done" ? (r.success === false ? "amber" : "green") : status === "queued" ? "amber" : "red";
  const fields: [string, string][] = [];
  if ("success" in r) fields.push(["success", String(r.success)]);
  for (const k of ["canceled_orders", "flatten_orders"]) {
    const v = r[k];
    if (v !== undefined && v !== null) fields.push([k, Array.isArray(v) ? String(v.length) : String(v)]);
  }
  if (r.remaining_exposure !== undefined && r.remaining_exposure !== null)
    fields.push(["remaining_exposure", isNum(r.remaining_exposure) ? fmtMoney(r.remaining_exposure) : String(r.remaining_exposure)]);
  if (r.error) fields.push(["error", String(r.error)]);
  if (r.note) fields.push(["note", String(r.note)]);
  return (
    <div className={`alert alert-${tone} control-result`} data-testid="control-result" role="status">
      <div className="control-result-head">
        <strong>
          {res.label}: {String(status).toUpperCase()}
        </strong>
        {res.resp && <span className="muted"> · command #{String(res.resp.command_id)}</span>}
        {res.resp?.halt_persisted && <span className="muted"> · halt persisted</span>}
        <button className="btn btn-ghost btn-xs" type="button" onClick={onClose} aria-label="Dismiss">
          ✕
        </button>
      </div>
      {res.error && <div>{res.error}</div>}
      {fields.length > 0 && (
        <dl className="kv-inline">
          {fields.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function ConfirmModal({
  def,
  busy,
  onCancel,
  onConfirm,
}: {
  def: ActionDef;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, discrepancy: boolean) => void;
}) {
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [discrepancy, setDiscrepancy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = typed === def.phrase;

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className={`modal modal-${def.tone}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title">{def.title}</h2>
        <ul className="modal-effects">
          {def.effect.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (matches && !busy) onConfirm(reason, discrepancy);
          }}
        >
          <label className="field">
            <span>
              Type <code className="phrase">{def.phrase}</code> to confirm
            </span>
            <input
              ref={inputRef}
              data-testid="confirm-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={def.phrase}
              maxLength={16}
            />
          </label>
          <label className="field">
            <span>Reason (optional, audit-logged)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
          </label>
          {def.action === "resume" && (
            <label className="check">
              <input type="checkbox" checked={discrepancy} onChange={(e) => setDiscrepancy(e.target.checked)} />
              <span>The halt cause has been investigated and any state discrepancy is explained</span>
            </label>
          )}
          <div className="modal-actions">
            <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              className={`btn ${def.tone === "resume" ? "btn-primary" : "btn-danger"}`}
              type="submit"
              data-testid="confirm-submit"
              disabled={!matches || busy}
            >
              {busy ? "Sending…" : `Confirm ${def.phrase}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function EmergencyControls({ halted, onDone }: { halted: boolean; onDone: () => void }) {
  const [open, setOpen] = useState<ControlAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ label: string; resp?: ControlResponse; error?: string } | null>(null);

  const run = async (action: ControlAction, reason: string, discrepancy: boolean) => {
    const def = ACTIONS[action];
    setBusy(true);
    setResult(null);
    try {
      const resp = await postControl(action, { confirm: def.phrase, reason, discrepancy_explained: discrepancy });
      setResult({ label: def.label, resp });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 429
            ? "Rate limit exceeded for control commands - wait and retry."
            : `HTTP ${err.status}: ${err.message}`
          : err instanceof Error
            ? `Request failed: ${err.message}`
            : "Request failed";
      setResult({ label: def.label, error: msg });
    } finally {
      setBusy(false);
      setOpen(null);
      onDone();
    }
  };

  const btn = (a: ControlAction, cls: string, disabled = false) => (
    <button
      type="button"
      className={`btn ${cls}`}
      data-testid={ACTIONS[a].testId}
      onClick={() => setOpen(a)}
      disabled={busy || disabled}
      title={a === "resume" && !halted ? "Trading is not halted" : ACTIONS[a].title}
    >
      {ACTIONS[a].label}
    </button>
  );

  return (
    <section className="panel emergency" aria-label="Emergency controls">
      <div className="emergency-row">
        <div className="emergency-title">
          <span className="emergency-icon" aria-hidden="true">
            ⚠
          </span>
          EMERGENCY CONTROLS
          {busy && <span className="muted small"> · command in flight…</span>}
        </div>
        <div className="emergency-buttons">
          {btn("flatten", "btn-danger btn-lg")}
          {btn("kill-switch", "btn-danger btn-lg")}
          {btn("cancel-orders", "btn-warn btn-lg")}
          {btn("resume", "btn-outline", !halted)}
        </div>
      </div>
      {result && <ResultBanner res={result} onClose={() => setResult(null)} />}
      {open && <ConfirmModal def={ACTIONS[open]} busy={busy} onCancel={() => setOpen(null)} onConfirm={(r, d) => run(open, r, d)} />}
    </section>
  );
}
