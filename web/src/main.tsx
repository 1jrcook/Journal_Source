import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { inJrPane, markJrPane } from './lib/jrTheme';
import './styles/obsidian.css';

if (inJrPane()) markJrPane();

// NOTE: /share/<id> never reaches the SPA — the server renders it (SEO/OG SSR).

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
