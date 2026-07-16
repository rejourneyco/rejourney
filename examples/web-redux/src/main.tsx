import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { initRejourney, Rejourney } from '@rejourneyco/browser';
import App from './App';
import { store } from './store';
import './styles.css';

const PROJECT_KEY = 'rj_99782207b2ccb644f2d97bb222bfd6db';

void initRejourney(PROJECT_KEY, {
  apiUrl: 'http://localhost:8080',
  autoStart: true,
  debug: true,
  recordAutomation: true,
  idleTimeout: false,
  maskAllInputs: false,
  maskInputOptions: { password: true, email: false, tel: true, hidden: true, text: false, number: false, search: false, url: false },
});

declare global {
  interface Window {
    __REJOURNEY_REDUX_AUDIT__: {
      getSessionId: () => string | null;
      getState: typeof store.getState;
      stop: () => Promise<void>;
    };
  }
}

window.__REJOURNEY_REDUX_AUDIT__ = {
  getSessionId: () => Rejourney.getSessionId(),
  getState: store.getState,
  stop: () => Rejourney.stop(),
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Provider store={store}><BrowserRouter><App /></BrowserRouter></Provider></React.StrictMode>,
);
