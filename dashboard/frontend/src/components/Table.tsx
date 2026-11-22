import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  title?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  empty: string;
  testId?: string;
  rowClass?: (row: T) => string | undefined;
  caption?: string;
}

export function Table<T>({ columns, rows, rowKey, empty, testId, rowClass, caption }: Props<T>) {
  return (
    <div className="table-wrap">
      <table className="tbl" data-testid={testId}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align ? `a-${c.align}` : undefined} title={c.title}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="empty-cell">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={rowKey(r, i)} className={rowClass?.(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align ? `a-${c.align}` : undefined}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  if (pages <= 1) return <div className="pager muted small num">{total.toLocaleString("en-US")} rows</div>;
  return (
    <div className="pager">
      <button className="btn btn-ghost btn-xs" type="button" onClick={() => onPage(0)} disabled={page === 0} aria-label="First page">
        «
      </button>
      <button className="btn btn-ghost btn-xs" type="button" onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page">
        ‹ Prev
      </button>
      <span className="muted small num">
        Page {page + 1} / {pages} · {total.toLocaleString("en-US")} rows
      </span>
      <button className="btn btn-ghost btn-xs" type="button" onClick={() => onPage(page + 1)} disabled={page >= pages - 1} aria-label="Next page">
        Next ›
      </button>
      <button className="btn btn-ghost btn-xs" type="button" onClick={() => onPage(pages - 1)} disabled={page >= pages - 1} aria-label="Last page">
        »
      </button>
    </div>
  );
}

export function LoadState({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  return (
    <>
      {error && <div className="alert alert-red small">Refresh failed: {error}</div>}
      {loading && !error ? <div className="empty">Loading…</div> : children}
    </>
  );
}
