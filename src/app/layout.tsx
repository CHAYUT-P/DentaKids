import type { Metadata, Viewport } from "next";
import { Mali, Mitr, Prompt } from "next/font/google";
import { LangProvider } from "@/i18n/lang";
import "./globals.css";
import "./home.css";
import "./pages.css";
import { ErrorReporter } from "@/components/shared/ErrorReporter";

const display = Mitr({
  variable: "--font-display",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
});

const body = Prompt({
  variable: "--font-body",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600"],
});

/** Reserved for one thing only: the child's name on the appointment slip. */
const child = Mali({
  variable: "--font-child",
  subsets: ["thai", "latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Denta Kids · จองนัดหมาย",
  description: "จองนัดหมายทันตกรรมสำหรับเด็ก เลือกหมอและเวลาที่สะดวก",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fdf4f6",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${display.variable} ${body.variable} ${child.variable}`}>
      <body>
        <LangProvider>{children}</LangProvider>
        <ErrorReporter />
      </body>
    </html>
  );
}
