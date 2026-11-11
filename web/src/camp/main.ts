import { mountPublicCamp } from './publicCamp';

// Точка входа публичной страницы сбора (camp.html). Без Telegram, без сервис-воркера, без хранения данных.
const root = document.getElementById('root');
if (root) mountPublicCamp(root, window.location.pathname);
