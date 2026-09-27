"use client";

import { useEffect, useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";

function subscribeConnection(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** Only public offline assets are cached. Business records always use the API. */
export function PwaRuntime() {
  const online = useSyncExternalStore(subscribeConnection, () => navigator.onLine, () => true);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let disposed = false;
    const register = () => {
      if (!disposed) {
        void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
          .catch(() => { /* Browsers that disallow workers still run the web application. */ });
      }
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => {
      disposed = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return online ? null : (
    <div className="connection-status" role="status">
      <WifiOff size={18} aria-hidden="true" />
      Internet uzildi. Saqlash va yuborish uchun ulanishni tiklang.
    </div>
  );
}
