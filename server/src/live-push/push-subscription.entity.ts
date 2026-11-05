import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('xmrpod_push_subscriptions')
export class PushSubscription {
  @PrimaryColumn('uuid') id: string;
  @Column() tokenHash: string;
  @Column('text') endpoint: string;
  @Column() p256dh: string;
  @Column() auth: string;
  @Column('uuid', { nullable: true }) challenge: string;
  @Column('timestamptz', { nullable: true }) verifiedAt: Date;
  @Column('timestamptz') expiresAt: Date;
}
