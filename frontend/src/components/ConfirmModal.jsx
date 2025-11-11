import React from 'react';

export default function ConfirmModal({
  show,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText,
  cancelText,
  extraButtons = [],
  children
}) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-lg w-auto max-w-[90%]">
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        {message && <div className="mb-4 text-sm">
          {message}
        </div>}
        {children && <div className="mb-4">{children}</div>}
        <div className="flex justify-end space-x-2">
          {/* butoane suplimentare (ex: Șterge pentru fiecare conflict) */}
          {extraButtons.map((btn, idx) => (
            <button
              key={idx}
              onClick={btn.onClick}
              className={`${btn.className || 'px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600'}`}
            >
              {btn.text}
            </button>
          ))}
          {/* buton de anulare */}
          <button
            className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
            onClick={onCancel}
          >
            {cancelText || 'Anulează'}
          </button>
          {/* buton de confirmare */}
          <button
            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
            onClick={onConfirm}
          >
            {confirmText || 'Șterge'}
          </button>
        </div>
      </div>
    </div>
  );
}
