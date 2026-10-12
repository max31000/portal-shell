import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Mvv42Provider } from '@mvv42/kit';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mvv42/kit/styles.css';
import './styles/global.css';
import App from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

// The shell is the top-level document (never embedded): it owns the shared colour-scheme setting and is not
// a service, so the kit's shell bridge stays idle. Accent `zinc` = the neutral shell look.
createRoot(root).render(
  <StrictMode>
    <Mvv42Provider serviceId="portal" accent="zinc" insideShell={false}>
      <App />
    </Mvv42Provider>
  </StrictMode>,
);
