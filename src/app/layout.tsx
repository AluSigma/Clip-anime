import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ClipAnime - Auto YouTube Clip Generator',
  description: 'Generate short viral clips from YouTube videos automatically',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>{children}</body>
    </html>
  );
}
