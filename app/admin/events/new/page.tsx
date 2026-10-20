import Link from "next/link";
import { connection } from "next/server";
import { MissingConfigError } from "@/lib/supabase";
import { DbNotMigratedError } from "@/lib/db-errors";
import { requireStudio } from "@/lib/admin-session";
import { ServerNotReady } from "@/app/_components/ServerNotReady";
import { DbNotReady } from "@/app/_components/DbNotReady";
import { NewEventForm } from "./NewEventForm";

export const metadata = { title: "Buat event" };

export const instant = false;

export default function Page() {
  return (
    <main className="shell">
      <View />
    </main>
  );
}

async function View() {
  await connection();

  try {
    return await Content();
  } catch (err) {
    if (err instanceof MissingConfigError) return <ServerNotReady />;
    if (err instanceof DbNotMigratedError) return <DbNotReady code={err.code} />;
    throw err;
  }
}

async function Content() {
  // Throws out of the try above only for config errors; a missing session redirects.
  await requireStudio();

  return (
    <div className="stack">
      <div className="topbar">
        <Link href="/admin">← Kembali ke daftar event</Link>
      </div>

      <header className="stack">
        <p className="eyebrow">Event baru</p>
        <h1>Buat event</h1>
        <p className="lede">
          Event disimpan sebagai draf. Setelah hari dan slot siap, terbitkan supaya klien
          bisa memesan.
        </p>
      </header>

      <NewEventForm />
    </div>
  );
}
