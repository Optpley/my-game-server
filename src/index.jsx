import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Telegram Mini App SDK (если понадобится)
import WebApp from "@twa-dev/sdk";

WebApp.ready(); // сообщает Telegram, что приложение загружено

const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
