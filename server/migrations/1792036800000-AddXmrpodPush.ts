import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddXmrpodPush1792036800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE xmrpod_push_subscriptions (id uuid PRIMARY KEY, token_hash varchar NOT NULL, endpoint text NOT NULL, p256dh varchar NOT NULL, auth varchar NOT NULL, challenge uuid, verified_at timestamptz, expires_at timestamptz NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE TABLE xmrpod_live_push_states (page_id integer PRIMARY KEY, session_id uuid NOT NULL, identities jsonb NOT NULL DEFAULT '{}', started_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE TABLE xmrpod_live_push_events (id uuid PRIMARY KEY, message jsonb NOT NULL, dispatched boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE INDEX xmrpod_push_pending ON xmrpod_live_push_events (expires_at) WHERE dispatched = false`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE xmrpod_live_push_events');
    await queryRunner.query('DROP TABLE xmrpod_live_push_states');
    await queryRunner.query('DROP TABLE xmrpod_push_subscriptions');
  }
}
