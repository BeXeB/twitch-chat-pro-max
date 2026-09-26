export interface EventSubMessage {
  metadata: {
    message_id: string;
    message_type: string;
    message_timestamp: string;
  };

  payload: any;
}
