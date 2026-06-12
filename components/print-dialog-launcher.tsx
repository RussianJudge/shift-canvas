"use client";

export function PrintDialogLauncher() {
  return (
    <div className="print-preview-launcher">
      <button
        type="button"
        className="ghost-button"
        onClick={() => {
          window.print();
        }}
      >
        Open print dialog
      </button>
    </div>
  );
}
