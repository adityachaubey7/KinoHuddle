import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import { WatchlistProvider } from './context/WatchlistContext.jsx';
import '@fontsource/big-shoulders-display/latin-700';
import '@fontsource/big-shoulders-display/latin-800';
import '@fontsource/big-shoulders-display/latin-900';
import '@fontsource/schibsted-grotesk/latin-400';
import '@fontsource/schibsted-grotesk/latin-500';
import '@fontsource/schibsted-grotesk/latin-600';
import '@fontsource/schibsted-grotesk/latin-700';
import './styles/global.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <NotificationProvider>
            <WatchlistProvider>
              <App />
            </WatchlistProvider>
          </NotificationProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);
