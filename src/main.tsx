import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { startBackendWatcher } from "@/store/backend";
import { useExchange } from "@/store/exchange";

// Thème initial
const stored = localStorage.getItem("kidzpos-theme");
if (stored === "light") document.documentElement.classList.add("light");

createRoot(document.getElementById("root")!).render(<App />);

// IMPORTANT : démarrer après le render pour laisser Zustand hydrater depuis localStorage.
// Sinon hydrateFromBackend() peut écraser les données offline avant qu'elles ne soient chargées.
queueMicrotask(() => {
  startBackendWatcher();
  if (navigator.onLine) {
    useExchange.getState().refresh(true);
  }
});

window.addEventListener("online", () => useExchange.getState().refresh(true));
