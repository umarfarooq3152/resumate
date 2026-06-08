import AppShell from '../../components/AppShell';
import { ToastProvider } from '../../components/Toast';

export default function AppLayout({ children }) {
  return (
    <ToastProvider>
      <AppShell>{children}</AppShell>
    </ToastProvider>
  );
}
