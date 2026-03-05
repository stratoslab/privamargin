import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import Landing from './Landing';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CssBaseline />
    <Landing />
  </StrictMode>,
);
