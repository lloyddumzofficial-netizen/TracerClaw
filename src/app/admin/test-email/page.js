import { redirect } from "next/navigation";

export default function AdminTestEmailRedirectPage() {
  redirect("/admin/send-email");
}
