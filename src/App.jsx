// This is the top-level React component.
// It defines the app routes and provides the "shell" for pages.
import { Navigate, Route, Routes } from 'react-router-dom'

// Pages are grouped under src/pages to keep routing clean.
import BattlePage from './pages/BattlePage.jsx'
import BehaviorTreeLabPage from './pages/BehaviorTreeLabPage.jsx'
import HomePage from './pages/HomePage.jsx'

// App-level styles (layout, shared typography, etc.).
import './App.css'

export default function App() {
  return (
    <Routes>
      {/* Default entry: go straight to the battle so you immediately see AI vs AI. */}
      <Route path="/" element={<Navigate to="/battle" replace />} />

      {/* Optional menu/landing page (kept for navigation) */}
      <Route path="/menu" element={<HomePage />} />

      {/* Battle (Phaser scene mounted in a React page) */}
      <Route path="/battle" element={<BattlePage />} />

      {/* Behavior Tree lab/editor (initially JSON-based; later can become a graph editor) */}
      <Route path="/lab/bt" element={<BehaviorTreeLabPage />} />

      {/* Default: redirect unknown routes to the battle */}
      <Route path="*" element={<Navigate to="/battle" replace />} />
    </Routes>
  )
}
