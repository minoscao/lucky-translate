import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Lucky Audio Lab · Two-speaker test',
  description: 'Test two independent music tracks on your headphones and speaker.',
};

export default function AudioTestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
