import { Column, Entity, PrimaryColumn } from 'typeorm';

export type LivePushMessage = {
  type: 'live' | 'verify' | 'test';
  sessionId?: string;
  path?: string;
  startedAt?: string;
  detectedAt?: string;
  nonce?: string;
};

@Entity('xmrpod_live_push_events')
export class LivePushEvent {
  @PrimaryColumn('uuid') id: string;
  @Column('jsonb') message: LivePushMessage;
  @Column({ default: false }) dispatched: boolean;
  @Column('timestamptz') expiresAt: Date;
}
