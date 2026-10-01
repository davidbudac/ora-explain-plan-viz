import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ConfirmProvider, ErrorBoundary, ToastProvider } from './components/ui'
import { registerServiceWorker } from './lib/pwa'

// Providers sit OUTSIDE the error boundary so toasts and confirm dialogs keep
// working (e.g. the fallback's "Copy error details" failure toast) after the
// app subtree has crashed.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
)

registerServiceWorker()
