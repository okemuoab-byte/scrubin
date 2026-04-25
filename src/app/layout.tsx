import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'ScrubIn — Navigate any clinical system with AI',
  description:
    'AI-powered clinical navigation assistant. See any healthcare system and get step-by-step guidance.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.className} h-full`}>
      <body className="h-full bg-white text-[#1a1a1a] antialiased">{children}</body>
    </html>
  );
}
