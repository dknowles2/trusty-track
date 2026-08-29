import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'urql'
import { graphqlClient } from './api/graphqlClient'
import { applyStoredAppTheme } from './theming/appTheme'
import App from './App.tsx'
import './index.css'

// Before React mounts anything, so a themed device never paints a frame of
// Field Uniform's colors first (#498). See `applyStoredAppTheme`'s own
// comment for why this is "before first paint" without an inline script in
// `index.html`.
applyStoredAppTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider value={graphqlClient}>
      <App />
    </Provider>
  </React.StrictMode>,
)
