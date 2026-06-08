import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center text-center px-4">
      <p className="text-6xl font-bold text-slate-200 mb-4">404</p>
      <h1 className="text-xl font-semibold text-slate-900 mb-2">Page not found</h1>
      <p className="text-sm text-slate-500 mb-6">This page doesn't exist or has been moved.</p>
      <Link href="/dashboard" className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
        Back to Dashboard
      </Link>
    </div>
  );
}
