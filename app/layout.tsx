import type { Metadata } from "next";
import { Bebas_Neue, Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const bebasNeue = Bebas_Neue({
  variable: "--font-bebas-neue",
  subsets: ["latin"],
  weight: "400",
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Keyboard Hero — Learn Piano Like a Headliner";
  const description =
    "A MIDI-powered piano trainer with 35 songs, Easy through Hard arrangements, practice loops, and a concert-stage feel.";

  return {
    metadataBase: new URL(origin),
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "Keyboard Hero",
      images: [
        {
          url: `${origin}/og-career.png`,
          width: 1731,
          height: 909,
          alt: "Keyboard Hero — 35 songs with Easy, Medium, and Hard arrangements.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og-career.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${bebasNeue.variable} antialiased`}
        style={
          {
            "--font-geist-sans": geistSans.style.fontFamily,
            "--font-geist-mono": geistMono.style.fontFamily,
            "--font-bebas-neue": bebasNeue.style.fontFamily,
            "--font-sans": geistSans.style.fontFamily,
            "--font-mono": geistMono.style.fontFamily,
            "--font-display": bebasNeue.style.fontFamily,
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  );
}
