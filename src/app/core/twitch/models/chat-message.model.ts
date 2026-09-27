export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  message: string;
  timestamp: string;
  color: string | null;
}
