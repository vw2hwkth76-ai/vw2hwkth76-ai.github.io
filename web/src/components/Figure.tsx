import type { ReactNode } from "react";

/** Kennzahl in einer Liste .ws-figures. */
export function Figure({ label, value, note }: { readonly label: string; readonly value: string; readonly note?: string | undefined }): ReactNode {
  return (
    <div className="ws-figure">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note ? <dd className="ws-figure__note">{note}</dd> : null}
    </div>
  );
}
