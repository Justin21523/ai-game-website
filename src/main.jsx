// This file is the React entry point. It bootstraps the app and mounts it to #root.
import { StrictMode } from 'react'
// BrowserRouter enables client-side routing (e.g., /battle, /lab/bt).
import { BrowserRouter } from 'react-router-dom'
// createRoot is the React 18+ API for creating a root renderer.
import { createRoot } from 'react-dom/client'
// Global CSS for the entire app.
import './index.css'
// App is the root React component that defines routes and shared UI.
import App from './App.jsx'

// Mount the React application into the HTML element with id="root".
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
