export interface ChatTarget {
  room?: string;
  recipient_user_id?: number;
}
export interface ChatMessage {
  id: string;
  client_message_id?: string;
  user_id: number;
  username: string;
  text: string;
  created_at: string;
  room?: string;
  recipient_user_id?: number;
}
export function chatConversation(target: ChatTarget, userId: number): string {
  return target.recipient_user_id
    ? `dm:${Math.min(userId, target.recipient_user_id)}:${Math.max(userId, target.recipient_user_id)}`
    : target.room || "lobby";
}
export function messageInConversation(
  message: ChatMessage,
  target: ChatTarget,
  userId: number,
): boolean {
  if (target.recipient_user_id)
    return (
      !message.room &&
      ((message.user_id === userId &&
        message.recipient_user_id === target.recipient_user_id) ||
        (message.user_id === target.recipient_user_id &&
          message.recipient_user_id === userId))
    );
  return message.room === (target.room || "lobby");
}
export function mergeChatMessages(
  messages: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  return [
    ...new Map(
      [...messages, ...incoming].map((message) => [message.id, message]),
    ).values(),
  ]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-100);
}
