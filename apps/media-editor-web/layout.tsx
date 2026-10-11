import { ReactNode } from 'react';

export const metadata = {
  title: '180 Media Studio | Autonomous Video Production Engine',
  description: 'Deterministic video editor, AI Creative Director, and compositor in 180workspace.'
};

export default function MediaEditorLayout({ children }: { children: ReactNode }) {
  return (
    <div className="w-full min-h-screen text-gray-900 dark:text-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </div>
    </div>
  );
}
