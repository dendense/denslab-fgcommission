import { redirect } from "next/navigation";

/** No marketing page in this demo — the only entry points are /e/[slug] and /admin. */
export default function Home() {
  redirect("/admin");
}
