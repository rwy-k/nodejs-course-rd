import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('processed_messages')
export class ProcessedMessage {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  messageId: string;

  @Column({ type: 'timestamptz' })
  processedAt: Date;

  @Column({ type: 'int' })
  orderId: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  handler: string | null;
}
