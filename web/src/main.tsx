import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { inTelegram } from './lib/telegram';
import './ui/tokens.css';
import './ui/kit.css';
import './styles.css';
import './ui/responsive.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Установка на главный экран из обычного браузера. Внутри Telegram сервис-воркер не нужен.
if ('serviceWorker' in navigator && !inTelegram()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* без сервис-воркера сайт работает как обычно, просто без предложения установки */
    });
  });
}
