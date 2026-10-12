import './globals.css';

export const metadata = {
    title: 'Mandat — user-owned authority for agents on Monad',
    description:
        'An agent holds an envelope, not a key. Every permission is capped, revocable, and enforced by contracts already live on Monad.',
    icons: {
        icon: '/favicon.svg',
    },
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body id="top">{children}</body>
        </html>
    );
}