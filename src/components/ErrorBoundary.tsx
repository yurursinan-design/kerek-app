import React from 'react';

interface State {
  failed: boolean;
}

function screenLanguage(): 'kz' | 'ru' {
  try {
    return localStorage.getItem('kerek_language_v1') === 'ru' ? 'ru' : 'kz';
  } catch {
    return 'kz';
  }
}

/**
 * Last line of defence: if a screen throws while drawing (for example on malformed data), show a
 * short message with a reload button instead of a blank white page.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[KEREK] Screen error caught:', error instanceof Error ? error.message : error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const kz = screenLanguage() === 'kz';
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="text-5xl" aria-hidden="true">😕</div>
          <h1 className="text-lg font-bold text-slate-900">
            {kz ? 'Бір нәрсе дұрыс болмады' : 'Что-то пошло не так'}
          </h1>
          <p className="text-sm text-slate-500">
            {kz ? 'Бетті қайта жүктеп көріңіз. Деректеріңіз сақталған.' : 'Попробуйте перезагрузить страницу. Ваши данные сохранены.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full min-h-[48px] rounded-2xl bg-sky-600 text-white font-bold"
          >
            {kz ? 'Қайта жүктеу' : 'Перезагрузить'}
          </button>
        </div>
      </div>
    );
  }
}
