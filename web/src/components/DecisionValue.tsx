import { CheckmarkFilled, WarningAltFilled } from "@carbon/icons-react";
import type { ReactNode } from "react";
import { SOURCE_LABEL } from "../../../src/app/labels.ts";
import type { DecisionView } from "../../../src/app/snapshot.ts";
import { confidence, STRENGTH_LABEL, type Strength, strengthOf } from "../format.ts";

export function StrengthMark({ strength }: { readonly strength: Strength }): ReactNode {
  if (strength === 4) return <CheckmarkFilled size={16} className="ws-value__review" aria-label={STRENGTH_LABEL[4]} />;
  return (
    <span className="ws-mark" data-strength={strength} role="img" aria-label={STRENGTH_LABEL[strength]}>
      <i />
      <i />
      <i />
    </span>
  );
}

export function decisionTitle(decision: DecisionView | undefined): string | undefined {
  if (!decision) return undefined;
  const conflict = decision.conflict
    ? `\nWiderspruch: ${decision.conflict.display} (${SOURCE_LABEL[decision.conflict.source]}: ${decision.conflict.evidence})`
    : "";
  return `${decision.display}\n${SOURCE_LABEL[decision.source]}, Konfidenz ${confidence(decision.confidence)}: ${decision.evidence}${conflict}`;
}

/** Wert einer Entscheidung mit Belegstaerke und Widerspruchsmarke. */
export function DecisionValue({ decision }: { readonly decision: DecisionView | undefined }): ReactNode {
  if (!decision) return <span className="ws-none">offen</span>;
  const strength = strengthOf(decision.source, decision.confidence);
  return (
    <span className={`ws-value${strength === 1 ? " ws-value--weak" : ""}`}>
      <StrengthMark strength={strength} />
      <span className="ws-value__text">{decision.display}</span>
      {decision.conflict ? <WarningAltFilled size={16} className="ws-value__conflict" aria-label="Widerspruch" /> : null}
    </span>
  );
}
