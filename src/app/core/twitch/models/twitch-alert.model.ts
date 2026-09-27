import { FollowEvent } from './follow-event.model';
import { SubscriptionEvent } from './subscription-event.model';
import { GiftSubscriptionEvent } from './gift-subscription-event.model';
import { BitsEvent } from './bits-event.model';
import { RaidEvent } from './raid-event.model';
import { ChannelPointRedemptionEvent } from './channel-point-redemption-event.model';

export type TwitchAlert =
  | {
      id: string;
      type: 'automation';
      timestamp: string;
      data: {
        message: string;
        title: string | null;
      };
    }
  | {
      id: string;
      type: 'follow';
      timestamp: string;
      data: FollowEvent;
    }
  | {
      id: string;
      type: 'subscription';
      timestamp: string;
      data: SubscriptionEvent;
    }
  | {
      id: string;
      type: 'gift-subscription';
      timestamp: string;
      data: GiftSubscriptionEvent;
    }
  | {
      id: string;
      type: 'bits';
      timestamp: string;
      data: BitsEvent;
    }
  | {
      id: string;
      type: 'raid';
      timestamp: string;
      data: RaidEvent;
    }
  | {
      id: string;
      type: 'redemption';
      timestamp: string;
      data: ChannelPointRedemptionEvent;
    };
