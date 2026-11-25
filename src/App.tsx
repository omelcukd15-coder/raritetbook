import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { UserSession } from './types/library';
import { getCurrentUser, pullCloudProgress } from './services/storageAndSync';
import { Header } from './components/Header/Header';
import { Footer } from './components/Footer/Footer';
import { AuthModal } from './components/AuthModal/AuthModal';
import { HomePage } from './pages/Home/HomePage';

const CatalogPage = lazy(() =>
  import('./pages/Catalog/CatalogPage').then((m) => ({ default: m.CatalogPage }))
);
const BookPage = lazy(() =>
  import('./pages/Book/BookPage').then((m) => ({ default: m.BookPage }))
);
const ReaderPage = lazy(() =>
  import('./pages/Reader/ReaderPage').then((m) => ({ default: m.ReaderPage }))
);
const AuthorPage = lazy(() =>
  import('./pages/Author/AuthorPage').then((m) => ({ default: m.AuthorPage }))
);
const AboutPage = lazy(() =>
  import('./pages/About/AboutPage').then((m) => ({ default: m.AboutPage }))
);
const AdminImportPage = lazy(() =>
  import('./pages/Admin/AdminImportPage').then((m) => ({ default: m.AdminImportPage }))
);

export const App: React.FC = () => {
  const [user, setUser] = useState<UserSession | null>(getCurrentUser);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    const syncAuth = () => setUser(getCurrentUser());
    window.addEventListener('raritetbook:auth-changed', syncAuth);
    void pullCloudProgress(true);
    return () => window.removeEventListener('raritetbook:auth-changed', syncAuth);
  }, []);

  return (
    <BrowserRouter>
      <Header user={user} onOpenAuth={() => setAuthOpen(true)} />
      <Suspense
        fallback={
          <div style={{ padding: '64px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Загрузка раздела библиотеки…
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<HomePage user={user} />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/book/:slug" element={<BookPage />} />
          <Route path="/read/:slug" element={<ReaderPage />} />
          <Route path="/author" element={<AuthorPage />} />
          <Route path="/about" element={<AboutPage section="about" />} />
          <Route path="/privacy" element={<AboutPage section="privacy" />} />
          <Route path="/terms" element={<AboutPage section="terms" />} />
          <Route path="/admin" element={<AdminImportPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Footer />
      <AuthModal open={authOpen} user={user} onClose={() => setAuthOpen(false)} />
    </BrowserRouter>
  );
};
