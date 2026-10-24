import { useEffect, useState } from 'react';
import { addToHomeScreen, homeScreenOffer } from '../lib/telegram';

// Предложение добавить приложение на экран «Домой». Не показывается вне Telegram, на старых клиентах и когда ярлык уже есть.
export default function HomeScreenPrompt() {
  const [offer, setOffer] = useState(false);
  useEffect(() => {
    let live = true;
    void homeScreenOffer().then(v => live && setOffer(v));
    return () => { live = false; };
  }, []);
  if (!offer) return null;
  return (
    <>
      <p className="ks-label">Быстрый доступ</p>
      <button type="button" className="ks-btn" onClick={addToHomeScreen}>Добавить на экран «Домой»</button>
      <p className="ks-muted" style={{ fontSize: 13, margin: '6px 0 12px' }}>Приложение клуба будет открываться одним нажатием, как обычное.</p>
    </>
  );
}
