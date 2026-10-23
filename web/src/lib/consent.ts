// ЧЕРНОВИК согласия родителя. Юридическую проверку (Грузия, защита персональных данных детей) текст не проходил:
// до проверки приложение не запускается для родителей (docs/CONSENT.md). При правке текста меняйте VERSION
// и добавьте новую версию в таблицу consent_versions (миграция), иначе база отклонит запрос.
export const CONSENT_VERSION = 'draft-2026-10-v2';

export type Lang = 'ru' | 'en';

export const CONSENT: Record<Lang, { title: string; points: string[]; checkbox: string; agree: [string, string, string] }> = {
  ru: {
    title: 'Согласие на показ данных ребёнка',
    points: [
      'Я подтверждаю, что я родитель или законный представитель ребёнка, которого выбираю.',
      'Я согласен(на), что в этом приложении мне будут показаны данные ребёнка: имя, группа, посещаемость тренировок, участие и результаты матчей, баллы рейтинга.',
      'Мои данные в приложении: имя и идентификатор в Telegram. Они нужны для входа и связи с ребёнком. Мой контакт в Telegram будет доступен тренерам группы моего ребёнка и администраторам клуба, чтобы связаться со мной.',
      'Данные ребёнка видят: я, тренеры его группы и администраторы клуба FC KickStart Tbilisi. Данные не передаются третьим лицам и не публикуются.',
      'Для работы приложения используются сервисы Telegram, Supabase и Cloudflare.',
      'Я могу отозвать согласие в любой момент, написав администратору клуба: связь с ребёнком будет отключена.',
    ],
    checkbox: 'Я прочитал(а) и согласен(на)',
    agree: ['Отправляя запрос, я соглашаюсь с ', 'Политикой конфиденциальности', ' и даю согласие на показ данных ребёнка.'],
  },
  en: {
    title: 'Consent to show my child’s data',
    points: [
      'I confirm that I am the parent or legal guardian of the child I select.',
      'I agree that this app will show me my child’s data: name, group, training attendance, match participation and results, rating points.',
      'My data in the app: my Telegram name and ID. They are used to sign in and to link me to my child. My Telegram contact will be available to the coaches of my child’s group and to the club administrators so that they can contact me.',
      'The child’s data is visible to me, the coaches of the child’s group and the administrators of FC KickStart Tbilisi. It is not shared with third parties or published.',
      'The app runs on Telegram, Supabase and Cloudflare services.',
      'I can withdraw my consent at any time by writing to the club administrator: the link to my child will be disabled.',
    ],
    checkbox: 'I have read and agree',
    agree: ['By sending the request, I agree to the ', 'Privacy Policy', ' and consent to my child’s data being shown to me.'],
  },
};
