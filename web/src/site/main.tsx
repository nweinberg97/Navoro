/**
 * Navoro public website entry. Served at `/` into <div id="root">.
 */
import '../styles/tokens.css';
import '../styles/base.css';
import './site.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Site } from './Site.tsx';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Site />
    </StrictMode>,
  );
}
