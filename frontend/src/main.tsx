import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'urql'
import { graphqlClient } from './api/graphqlClient'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider value={graphqlClient}>
      <App />
    </Provider>
  </React.StrictMode>,
)
