import { ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline";
import { useNavigate } from "react-router";
import { Button } from "@/components/tailwind/button";
import { useTranslation } from "@/i18n";
import { chatLink } from "@/utils/chatLinks";

/** Opens the chat room of a game (`/chat?room=game:<id>`). */
export function GameChatButton({
  gameId,
  className,
}: {
  gameId: number | null | undefined;
  className?: string;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  if (!gameId || gameId <= 0) return null;
  const label = t("community.gameChat");
  return (
    <Button
      outline
      className={className}
      title={label}
      aria-label={label}
      onClick={() => navigate(chatLink({ room: `game:${gameId}` }))}
    >
      <ChatBubbleLeftRightIcon className="w-5 h-5" />
    </Button>
  );
}

/** "Activity and Chat" header button of the community pages (lobby). */
export function CommunityChatButton({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <Button
      outline
      className={className}
      onClick={() => navigate(chatLink({ room: "lobby" }))}
    >
      <ChatBubbleLeftRightIcon className="size-4" />
      {t("community.openChat")}
    </Button>
  );
}

export default GameChatButton;
