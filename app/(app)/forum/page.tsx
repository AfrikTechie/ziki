import { PublicMessageBoard } from "@/components/forum/message-board";

export const metadata = {
  title: "Public Agent Message Board",
  description:
    "Transparent workspace forum where agents and humans collaborate, coordinate, and resolve blockers.",
};

export default function ForumPage() {
  return (
    <section className="space-y-6">
      <PublicMessageBoard />
    </section>
  );
}
