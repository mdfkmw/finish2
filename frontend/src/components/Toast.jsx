import React, { useEffect, useState } from "react";

const colors = {
  success: 'bg-green-100 text-green-800 border-green-300',
  error: 'bg-red-100 text-red-800 border-red-300',
  info: 'bg-blue-100 text-blue-800 border-blue-300',
};

const Toast = (props) => {
  const [toastMessage, setToastMessage] = useState(props.message || "");
  const [toastType, setToastType] = useState(props.type || "info");
  const [show, setShow] = useState(!!props.message);

  // Dacă primește props de la părinte (rămâne compatibil cu vechiul mod)
  useEffect(() => {
    if (props.message) {
      setToastMessage(props.message);
      setToastType(props.type || "info");
      setShow(true);
      setTimeout(() => setShow(false), 6000);
    }
  }, [props.message, props.type]);

  // ASCULTĂ ȘI GLOBAL!
  useEffect(() => {
    const handler = (event) => {
      setToastMessage(event.detail.message);
      setToastType(event.detail.type || "info");
      setShow(true);
      setTimeout(() => setShow(false), 6000);
    };
    window.addEventListener("toast", handler);
    return () => window.removeEventListener("toast", handler);
  }, []);

  if (!show) return null;

  return (
    <div
      className={`fixed top-4 right-4 z-50 border px-4 py-2 rounded shadow ${colors[toastType] || colors.info}`}
      style={{ minWidth: "220px", maxWidth: "420px" }}
    >
      {toastMessage}
    </div>
  );
};

export default Toast;