import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('xmrpod_live_push_states')
export class LivePushState {
  @PrimaryColumn() pageId: number;
  @Column('uuid') sessionId: string;
  @Column('jsonb', { default: {} }) identities: Record<string, string>;
  @Column('timestamptz') startedAt: Date;
  @Column('timestamptz') lastSeenAt: Date;
}
