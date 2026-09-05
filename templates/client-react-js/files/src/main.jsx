import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { AuthProvider } from './context/AuthContext';
import './styles/index.css';

const container = document.getElementById('root');

if (container === null) {
  throw new Error('index.html is missing the #root element React mounts into.');
}

/**
 * `AuthProvider` sits inside `BrowserRouter` because the routes it guards need both, and the
 * provider itself never navigates — the guards do.
 */
createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
