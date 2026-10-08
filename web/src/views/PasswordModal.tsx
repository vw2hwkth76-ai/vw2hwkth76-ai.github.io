import { Modal, PasswordInput } from "@carbon/react";
import { type ReactNode, useEffect, useState } from "react";

interface Props {
  readonly open: boolean;
  readonly fileName: string;
  readonly wrong: boolean;
  readonly onSubmit: (password: string) => void;
  readonly onCancel: () => void;
}

/** Das Passwort lebt nur in diesem Dialog und im Worker-Aufruf; es wird nirgends abgelegt. */
export function PasswordModal(props: Props): ReactNode {
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!props.open) setPassword("");
  }, [props.open]);

  const submit = (): void => {
    if (password === "") return;
    const value = password;
    setPassword("");
    props.onSubmit(value);
  };

  return (
    <Modal
      open={props.open}
      size="sm"
      modalHeading="Projektpasswort"
      modalLabel={props.fileName}
      primaryButtonText="Öffnen"
      secondaryButtonText="Abbrechen"
      primaryButtonDisabled={password === ""}
      shouldSubmitOnEnter
      onRequestSubmit={submit}
      onRequestClose={props.onCancel}
    >
      <p className="cds--modal-content__text">
        Das Projekt ist in der ETS mit einem Passwort geschützt. Das Passwort dient nur zum Entschlüsseln in diesem Browser und wird nicht gespeichert.
      </p>
      <PasswordInput
        id="projektpasswort"
        labelText="Passwort"
        autoComplete="off"
        value={password}
        invalid={props.wrong && password === ""}
        invalidText="Das Passwort passt nicht zu diesem Projekt."
        onChange={(event) => setPassword(event.target.value)}
        data-modal-primary-focus
        hidePasswordLabel="Passwort verbergen"
        showPasswordLabel="Passwort anzeigen"
      />
    </Modal>
  );
}
