import { X } from "lucide-react";

export default function ActionConfirmDialog(props: {
  open: boolean;
  title: string;
  description: string;
  cancelText: string;
  confirmText: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!props.open) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header">
          <h2>{props.title}</h2>
          <button
            type="button"
            className="icon-button modal-close"
            aria-label={props.cancelText}
            onClick={props.onCancel}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="muted">{props.description}</p>
        <div className="modal-actions">
          <button type="button" className="button subtle" onClick={props.onCancel}>
            {props.cancelText}
          </button>
          <button type="button" className="button primary" onClick={props.onConfirm}>
            {props.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
