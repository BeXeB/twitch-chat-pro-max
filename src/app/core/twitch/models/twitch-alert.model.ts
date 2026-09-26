import { BitsEvent } from "./bits-event.model";
import { ChannelPointRedemptionEvent } from "./channel-point-redemption-event.model";
import { FollowEvent } from "./follow-event.model";
import { GiftSubscriptionEvent } from "./gift-subscription-event.model";
import { RaidEvent } from "./raid-event.model";
import { SubscriptionEvent } from "./subscription-event.model";

export type TwitchAlertType =
  | 'follow'
  | 'subscription'
  | 'gift-subscription'
  | 'bits'
  | 'raid'
  | 'redemption';

export interface TwitchAlert {
  id: string;
  type: TwitchAlertType;
  timestamp: string;
  data:
    | FollowEvent
    | SubscriptionEvent
    | GiftSubscriptionEvent
    | BitsEvent
    | RaidEvent
    | ChannelPointRedemptionEvent;
}
