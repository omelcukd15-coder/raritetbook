import React, { useState } from 'react';
import { AlertCircle, LogOut, X } from 'lucide-react';
import type { UserSession } from '../../types/library';
import { loginAccount, logoutAccount, registerAccount } from '../../services/storageAndSync';

interface AuthModalProps {
  open: boolean;
  user: UserSession | null;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ open, user, onClose }) => {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'register') {
        await registerAccount(email, password);
      } else {
        await loginAccount(email, password);
      }
      setEmail('');
      setPassword('');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Ошибка авторизации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rb-modal-overlay" onClick={onClose}>
      <div className="rb-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.65rem', margin: 0 }}>
            {user ? 'Читательский билет' : tab === 'register' ? 'Регистрация' : 'Вход в архив'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)' }}
            aria-label="Закрыть"
          >
            <X size={20} />
          </button>
        </div>

        {user ? (
          <div>
            <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
              Вы вошли как <strong style={{ color: 'var(--text-main)' }}>{user.email}</strong>.
            </p>
            <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
              Прогресс чтения, закладки и настройки читалки автоматически сохраняются и синхронизируются.
            </p>
            <button
              type="button"
              className="rb-btn"
              style={{ width: '100%', marginTop: 12 }}
              onClick={async () => {
                await logoutAccount();
                onClose();
              }}
            >
              <LogOut size={16} /> Выйти из аккаунта
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button
                type="button"
                className={`rb-chip ${tab === 'login' ? 'rb-chip--active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => {
                  setTab('login');
                  setError('');
                }}
              >
                Вход
              </button>
              <button
                type="button"
                className={`rb-chip ${tab === 'register' ? 'rb-chip--active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => {
                  setTab('register');
                  setError('');
                }}
              >
                Регистрация
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
              Единый облачный аккаунт для компьютера и телефона: закладки и страница чтения синхронизируются автоматически.
            </p>

            <form onSubmit={handleSubmit}>
              <input
                type="email"
                required
                maxLength={120}
                autoComplete="email"
                className="rb-field"
                placeholder="E-mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                type="password"
                required
                minLength={6}
                maxLength={128}
                autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
                className="rb-field"
                placeholder="Пароль (минимум 6 символов)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <div className="rb-warning-box">
                <AlertCircle size={18} style={{ flexShrink: 0, color: 'var(--gold-bright)', marginTop: 2 }} />
                <span>
                  Внимание: восстановление пароля по почте не предусмотрено. Обязательно сохраните логин и пароль в браузере или заметках.
                </span>
              </div>

              {error && (
                <div style={{ color: '#f28b6d', fontSize: '0.84rem', marginBottom: 10 }}>{error}</div>
              )}

              <button type="submit" disabled={loading} className="rb-btn rb-btn--gold" style={{ width: '100%' }}>
                {loading ? 'Подождите...' : tab === 'register' ? 'Создать аккаунт' : 'Войти'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
